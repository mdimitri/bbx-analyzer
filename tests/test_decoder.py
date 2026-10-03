"""The fast decoder must give exactly what orangebox gives, and survive broken logs."""
import math
import shutil

import numpy as np
import pytest
from orangebox import Parser

import fastbbl
from conftest import DATA, full_logs


def ref_rows(path, idx=1):
    p = Parser.load(str(path), idx)
    rows, err = [], None
    try:
        for f in p.frames():
            rows.append([math.nan if v == "" else v for v in f.data[:len(p.field_names)]])
    except Exception as e:  # truncated log: orangebox stops with an exception, like ours
        err = e
    return p.field_names, np.array(rows, float), err


def check_same(path, idx=1):
    H, names, rows, trunc, _ = fastbbl.decode(path, idx)
    rn, ref, err = ref_rows(path, idx)
    assert names == rn
    got = np.array(rows, float)
    assert got.shape == ref.shape
    assert np.array_equal(got, ref, equal_nan=True)
    assert (trunc is None) == (err is None)
    return got


def test_short_log_matches_orangebox(short_log):
    got = check_same(short_log)
    assert len(got) > 10000


@pytest.mark.parametrize("path", full_logs(), ids=lambda p: p.name)
def test_full_logs_match_orangebox(path):
    for idx in range(1, Parser.load(str(path)).reader.log_count + 1):
        check_same(path, idx)


def test_truncated_log_keeps_frames_before_the_cut(short_log):
    _, _, rows, trunc, _ = fastbbl.decode(short_log)
    assert trunc, "short.bbl ends mid-frame, the decoder must say so"
    assert len(rows) > 10000


def test_corrupt_bytes_do_not_crash(tmp_path):
    raw = bytearray((DATA / "short.bbl").read_bytes())
    hdr_end = raw.find(b"\nI") + 1
    rng = np.random.default_rng(0)
    for pos in rng.integers(hdr_end + 5000, len(raw) - 100, 40):   # flip 40 random bytes in the frame data
        raw[pos] ^= 0x5A
    p = tmp_path / "corrupt.bbl"
    p.write_bytes(bytes(raw))
    check_same(p)          # same recovery behaviour as orangebox, no exception


def test_two_sublogs_in_one_file(tmp_path):
    raw = (DATA / "short.bbl").read_bytes()
    cut = raw[: len(raw) // 2]
    p = tmp_path / "two.bbl"
    p.write_bytes(cut + raw)       # a file with two logs, the first one cut short
    assert Parser.load(str(p)).reader.log_count == 2
    check_same(p, 1)
    check_same(p, 2)


def test_log_class_uses_fast_path_and_caches(short_log):
    from bbl import Log
    lg = Log(short_log, 1)
    assert lg.fs > 500 and len(lg.t) > 10000
    assert "_truncated" in lg.headers
    import time
    for _ in range(50):              # the cache is written in the background
        if short_log.with_suffix(".1.npz").exists():
            break
        time.sleep(0.1)
    lg2 = Log(short_log, 1)
    assert np.array_equal(lg.cols["gyroADC[0]"], lg2.cols["gyroADC[0]"])
