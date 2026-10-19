"""Fast Betaflight blackbox decoder.

Same output as orangebox (it is the reference, see tests/test_decoder.py), several times faster: instead of calling
a decoder and a predictor function per field through a byte-by-byte iterator, it generates one specialised Python
function per frame type from the log's own field definitions, with the variable-byte decoding inlined, and runs it
over the raw bytes. orangebox is still used to read the headers and field definitions.

Orangebox behaviours reproduced on purpose (so both decoders agree byte for byte): its tag8_8svb grouping at the end
of a frame, unsigned 32-bit values in tag2_3s32, the iteration-jump check, dropping a frame whose next byte is not a
frame marker, and resynchronising one byte after a corrupt frame start.
"""
from orangebox.reader import Reader

FRAME_CHARS = {ord(c) for c in "IPGSHE"}
MAX_ITER_JUMP = 500 * 10
NAN = float("nan")


class DecodeError(Exception):
    pass


def _uvb(d, p):
    """Unsigned variable-byte at p (up to 5 bytes; longer → 0, as orangebox). Returns (value, new p)."""
    r = s = 0
    for _ in range(5):
        b = d[p]; p += 1
        r |= (b & 0x7F) << s
        if b < 128:
            return r, p
        s += 7
    return 0, p


def _gen(fdefs, ftype, ctx_names, minthrottle, vbatref, motor_min, data_version):
    """Python source of a function decoding one frame of this type: (d, p, p0, p1, skip, home) -> (values, p)."""
    n = len(fdefs)
    L = [f"def dec_{ftype}(d, p, p0, p1, skip, home):", f"    o = [0] * {n}"]
    m0 = ctx_names.get("motor[0]")
    encs = [f.encoding for f in fdefs]

    def uvb(var):
        # one-byte fast path inline, the rest through _uvb
        return [f"    b = d[p]", f"    if b < 128:", f"        {var} = b; p += 1", f"    else:", f"        {var}, p = _uvb(d, p)"]

    def svb(var):
        return uvb(var) + [f"    {var} = (({var} & 0xFFFFFFFF) >> 1) ^ -({var} & 1)"]

    def pred(i, raw):
        pr = fdefs[i].predictor
        if fdefs[i].name == "GPS_coord[1]" and pr == 7:
            pr = 256
        prev = f"(p0[{i}] if p0 is not None and {i} < len(p0) else 0)"
        if pr == 0:
            return f"    o[{i}] = {raw}"
        if pr == 1:
            return f"    o[{i}] = {raw} + {prev}"
        if pr in (2, 3):
            out = [f"    pv = {prev}", f"    pv2 = p1[{i}] if p1 is not None and {i} < len(p1) else pv"]
            out.append(f"    o[{i}] = {raw} + 2 * pv - pv2" if pr == 2 else f"    o[{i}] = {raw} + int((pv + pv2) / 2)")
            return "\n".join(out)
        if pr == 4:
            return f"    o[{i}] = {raw} + {minthrottle}"
        if pr == 5:
            return f"    o[{i}] = {raw} + (o[{m0}] if {m0 is not None} and {m0 if m0 is not None else 0} < {i} else 0)"
        if pr == 6:
            return f"    o[{i}] = 1 + {prev} + skip"
        if pr == 7:
            return f"    o[{i}] = ({raw} + home[0]) if home else 0"
        if pr == 256:
            return f"    o[{i}] = ({raw} + home[1]) if home else 0"
        if pr == 8:
            return f"    o[{i}] = {raw} + 1500"
        if pr == 9:
            return f"    o[{i}] = {raw} + {vbatref}"
        if pr == 10:
            return f"    o[{i}] = {raw} + (p1[{i}] if p1 is not None and {i} < len(p1) else 0)"
        if pr == 11:
            return f"    o[{i}] = {raw} + {motor_min}"
        raise DecodeError(f"predictor {pr} not supported")

    i = 0
    while i < n:
        e = encs[i]
        if e == 0:
            L += svb("r"); L.append(pred(i, "r")); i += 1
        elif e == 1:
            L += uvb("r"); L.append(pred(i, "r")); i += 1
        elif e == 3:
            L += uvb("r"); L.append("    r = -(((r & 0x3FFF) - 0x4000) if r & 0x2000 else r)"); L.append(pred(i, "r")); i += 1
        elif e == 9:
            L.append(pred(i, "0")); i += 1
        elif e == 6:
            g = 8   # orangebox's grouping, end-of-frame case included
            for j in range(i + 1, i + 8):
                if j == n:
                    g = (n - 1) - i
                    break
                if encs[j] != 6:
                    g = j - i
                    break
            if g == 1:
                L += svb("r"); L.append(pred(i, "r")); i += 1
            else:
                L += ["    h = d[p]; p += 1"]
                for k in range(g):
                    L += ["    if h & 1:"] + ["    " + x for x in svb("r")] + ["    else:", "        r = 0", "    h >>= 1"]
                    L.append(pred(i + k, "r"))
                i += g
        elif e == 7:
            L += ["    a = d[p]; p += 1", "    t = a >> 6",
                  "    if t == 0:",
                  "        v = [(a >> 4) & 3, (a >> 2) & 3, a & 3]; v = [x - 4 if x & 2 else x for x in v]",
                  "    elif t == 1:",
                  "        b2 = d[p]; p += 1; v = [a & 15, b2 >> 4, b2 & 15]; v = [x - 16 if x & 8 else x for x in v]",
                  "    elif t == 2:",
                  "        v = [a & 63, d[p] & 63, d[p + 1] & 63]; p += 2; v = [x - 64 if x & 32 else x for x in v]",
                  "    else:",
                  "        v = []",
                  "        for _ in range(3):",
                  "            ft = a & 3",
                  "            if ft == 0:",
                  "                x = d[p]; p += 1; v.append(x - 256 if x & 0x80 else x)",
                  "            elif ft == 1:",
                  "                x = d[p] | (d[p + 1] << 8); p += 2; v.append(x - 65536 if x & 0x8000 else x)",
                  "            elif ft == 2:",
                  "                x = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16); p += 3; v.append(x - 16777216 if x & 0x800000 else x)",
                  "            else:",
                  "                x = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24); p += 4; v.append(x)",
                  "            a >>= 2"]
            for k in range(3):
                if i + k < n:
                    L.append(pred(i + k, f"v[{k}]"))
            i += 3
        elif e == 8:
            if data_version < 2:
                raise DecodeError("tag8_4s16 v1 not supported")
            L += ["    sel = d[p]; p += 1; v = [0, 0, 0, 0]; nib = 0; buf = 0",
                  "    for k in range(4):",
                  "        ft = sel & 3",
                  "        if ft == 1:",
                  "            if nib == 0:",
                  "                buf = d[p]; p += 1; x = buf >> 4; nib = 1",
                  "            else:",
                  "                x = buf & 15; nib = 0",
                  "            v[k] = x - 16 if x & 8 else x",
                  "        elif ft == 2:",
                  "            if nib == 0:",
                  "                x = d[p]; p += 1",
                  "            else:",
                  "                x = (buf & 15) << 4; buf = d[p]; p += 1; x |= buf >> 4",
                  "            v[k] = x - 256 if x & 0x80 else x",
                  "        elif ft == 3:",
                  "            if nib == 0:",
                  "                x = (d[p] << 8) | d[p + 1]; p += 2",
                  "            else:",
                  "                x = ((buf & 15) << 12) | (d[p] << 4) | (d[p + 1] >> 4); buf = d[p + 1]; p += 2",
                  "            v[k] = x - 65536 if x & 0x8000 else x",
                  "        sel >>= 2"]
            for k in range(4):
                if i + k < n:
                    L.append(pred(i + k, f"v[{k}]"))
            i += 4
        else:
            raise DecodeError(f"encoding {e} not supported")
    L.append("    return o, p")
    return "\n".join(L)


def _skip_events(d, p, n):
    """Parse one event frame body at p. Returns (new p, end_of_log, ok)."""
    if p >= n:
        return p, False, False
    et = d[p]; p += 1
    if et in (0, 15, 40, 50, 51, 52):
        _, p = _uvb(d, p)
    elif et in (14, 30):
        _, p = _uvb(d, p); _, p = _uvb(d, p)
    elif et == 13:
        fn = d[p]; p += 1
        if fn & 0x80:
            p += 4
        else:
            _, p = _uvb(d, p)
    elif et in (10, 11, 12, 20, 251):
        pass
    elif et in (100, 101):
        ln = d[p]; p += 1 + ln
    elif et == 255:
        if d[p:p + 10] != b"End of log":
            raise ValueError("Invalid 'End of log' message")
        return p, True, True
    else:
        return p, False, False   # unknown event type: orangebox counts it invalid and keeps scanning
    return p, False, True


def decode(path, idx=1, progress=None):
    """Decode sub-log idx. Returns (headers, field_names, rows, truncated_message). rows: list of lists, "" where a slow
    or GPS field has no value yet (exactly like orangebox's frames)."""
    rd = Reader(str(path), idx)
    H = rd.headers
    fd = rd.field_defs
    by = {ft.value: v for ft, v in fd.items()}
    if "I" not in by or "P" not in by:
        raise DecodeError("no I/P field definitions")
    names_I = [f.name for f in by["I"]]
    names = list(names_I)
    for t in ("S", "G"):
        if t in by:
            names += [f.name for f in by[t] if f.name is not None and f.name not in names]
    ctx_names = {nm: i for i, nm in enumerate(names_I)}
    mt = H.get("minthrottle", 0) or 0
    vb = H.get("vbatref", 0) or 0
    mo = H.get("motorOutput", [0, 0])
    mo0 = (mo[0] if isinstance(mo, list) else mo) or 0
    dv = H.get("Data version", 1)
    env = {"_uvb": _uvb}
    decs = {}
    for t, fdefs in by.items():
        src = _gen(fdefs, t, ctx_names, mt, vb, mo0, dv)
        exec(compile(src, f"<bbx-decoder-{t}>", "exec"), env)
        decs[t] = env[f"dec_{t}"]
    # frame interval bookkeeping (increment predictor)
    i_int = max(1, int(H.get("I interval", 1) or 1))
    pint = H.get("P interval", 0)
    if isinstance(pint, int):
        p_num, p_den = 1, pint
    else:
        a, b = str(pint).split("/"); p_num, p_den = int(a), int(b)

    def should_have(ix):
        return (ix % i_int + p_num - 1) % p_den < p_num

    d = rd._frame_data
    n = len(d)
    p = 0
    p0 = p1 = None
    last_iter = -1          # orangebox ctx.last_iter: iteration of the last parsed main frame
    chk_last_iter = 0       # the frames() loop's own last_iter (for the jump check)
    last_slow = None
    last_gps = None
    home = None
    nS = len(by["S"]) if "S" in by else 0
    nG = len(by["G"]) if "G" in by else 0
    i_it = ctx_names.get("loopIteration", 0)
    rows = []
    last_frame_pos = 0
    corrupt = False
    trunc = None
    dI, dP = decs["I"], decs["P"]
    dS, dG, dH = decs.get("S"), decs.get("G"), decs.get("H")
    step = 20000
    try:
        while True:
            if p >= n:
                raise RuntimeError(f"Unexpected end of log at offset 0x{p:X}")
            c = d[p]; p += 1
            if c not in FRAME_CHARS:
                if not corrupt:
                    p = last_frame_pos + 1
                corrupt = True
                continue
            corrupt = False
            last_frame_pos = p - 1
            if c == 69:   # 'E'
                p, end, _ = _skip_events(d, p, n)
                if end:
                    break
                continue
            if c == 83:   # 'S'
                if dS is None:
                    continue
                last_slow, p = dS(d, p, p0, p1, 0, home)
                continue
            if c == 71:   # 'G'
                if dG is None:
                    continue
                last_gps, p = dG(d, p, p0, p1, 0, home)
                continue
            if c == 72:   # 'H'
                if dH is None:
                    continue
                hv, p = dH(d, p, p0, p1, 0, home)
                home = hv
                continue
            # main frame
            if c == 73:
                o, p = dI(d, p, p0, p1, 0, home)
            else:
                skip = 0
                if last_iter != -1:
                    ix = last_iter + 1
                    while not should_have(ix):
                        ix += 1
                    skip = ix - last_iter - 1
                o, p = dP(d, p, p0, p1, skip, home)
            cur_iter = o[i_it]
            last_iter = cur_iter
            if chk_last_iter >= cur_iter and MAX_ITER_JUMP < cur_iter + chk_last_iter:
                chk_last_iter = cur_iter
                continue
            chk_last_iter = cur_iter
            if nS:
                o = o + (last_slow if last_slow is not None else [NAN] * nS)
            if nG:
                o = o + (last_gps[1:] if last_gps is not None else [NAN] * (nG - 1))
            if d[p] not in FRAME_CHARS:      # IndexError at the very end, like orangebox
                continue
            if c == 73:
                p0 = p1 = o
            else:
                p0, p1 = o, p0
            rows.append(o)
            if progress and len(rows) % step == 0:
                progress(len(rows), p / n)
    except Exception as e:   # a log cut off by full flash / power loss ends in a broken frame: keep everything before it
        trunc = f"{type(e).__name__}: {e}"[:160]
    return H, names, rows, trunc, rd
