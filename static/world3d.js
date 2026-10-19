// Three.js renderer for the splash: draws the toy world from world.js (terrain, ~1,300 objects as 100 instanced kinds,
// water, sky), the quad from the simulated flight (same data layout as a real log), its wash and trail, and three cameras
// (chase, wide, FPV). Loaded on demand; if WebGL or the module is missing the splash falls back to the 2D viewer.
const W3 = (() => {
  const QS = 3;                       // the quad is drawn 3× life size: a 7″ quad is then about 1.2 m across next to 4.4 m cars and 8 m houses: big enough to follow, small enough to look like a drone
  const MPOS3 = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => [x * 0.11, y * 0.11]);   // M1 RR, M2 FR, M3 RL, M4 FL (x forward, y left), real metres
  const SPIN3 = [-1, 1, 1, -1];
  let T = null;                       // the three module
  const loadThree = async () => T || (T = await import("/static/vendor/three.module.min.js"));
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Black and white, wireframe with the shading kept: faces are grey Lambert surfaces (lit by a sun and a sky), every crease and outline is a thin line in the opposite tone,
  // and the surface textures (windows, roof ridges, road markings) are drawn as lines too. dark: white lines on a black world; light: ink lines on paper.
  const PAL = {
    dark: { top: 0x000000, mid: 0x050505, hor: 0x1c1c1c, sun: 0xffffff, sunI: 1.5, hemiS: 0xbdbdbd, hemiG: 0x242424, hemiI: 0.62, fog: 0x1c1c1c, water: 0x080808,
            tDark: 0.62, oDark: 0.55, eTint: 0xbfc4cc, eAmt: 0.5, txA: 0.28, grid: 0xaab0b8, g1: 0.045, g2: 0.12, mk: 0.55, road: 0.05, walk: 0.16, ink: 0xbfc4cc },
    light: { top: 0xcfcfcf, mid: 0xe2e2e2, hor: 0xf4f4f4, sun: 0xffffff, sunI: 1.9, hemiS: 0xffffff, hemiG: 0xb0b0b0, hemiI: 1.0, fog: 0xf2f2f2, water: 0xd8d8d8,
             tDark: 1.15, oDark: 1.18, eTint: 0x4a4f57, eAmt: 0.5, txA: 0.28, grid: 0x50555d, g1: 0.045, g2: 0.12, mk: 0.55, road: 0.60, walk: 0.98, ink: 0x4a4f57 },
  };
  // the quad wears the app's own sequential colormap (the spectrogram's), so it stands out from the grey world
  const seqStops = () => getComputedStyle(document.documentElement).getPropertyValue("--seq").split(",").map(c => new T.Color(c.trim()));
  const seqAt = (st, g, out) => { const x = Math.max(0, Math.min(1, g)) * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)); return out.copy(st[i]).lerp(st[i + 1], x - i); };
  const theme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";

  // ---------- geometry helpers: everything is built in three-space (x right, y up, z = −sim y) ----------
  function primGeo(p, kind) {
    const g = (() => {
      switch (p.k) {
        case "box": return new T.BoxGeometry(p.sx, p.sz, p.sy).translate(0, p.sz / 2, 0);
        case "cyl": { const c = new T.CylinderGeometry(p.r2, p.r, p.h, p.seg); if (p.ax === "y") return c.rotateX(Math.PI / 2); if (p.ax === "x") return c.rotateZ(Math.PI / 2); return c.translate(0, p.h / 2, 0); }
        case "sph": return new T.IcosahedronGeometry(p.r, kind && (kind.cat === "tree" || p.r > 1.6) ? 1 : 0).translate(0, p.r, 0);
        case "dome": return new T.SphereGeometry(p.r, Math.max(8, Math.min(16, Math.round(p.r * 3))), 5, 0, Math.PI * 2, 0, Math.PI / 2);
        case "tor": return new T.TorusGeometry(p.R, p.t, 6, 20).translate(0, p.R, 0);
        case "rod": { const g = new T.BoxGeometry(p.t, Math.hypot(p.dx, p.dy, p.dz) || 1e-3, p.t); return g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(p.dx, p.dz, -p.dy).normalize())); }   // centred on x y z
        case "prism": { const a = p.sx / 2, b = p.sy / 2, h = p.sz, P = new T.BufferGeometry(), v = [];
          const q = (A, B, C, D) => v.push(...A, ...B, ...C, ...A, ...C, ...D), t = (A, B, C) => v.push(...A, ...B, ...C);
          const b1 = [-a, 0, -b], b2 = [a, 0, -b], b3 = [a, 0, b], b4 = [-a, 0, b], r1 = [-a, h, 0], r2 = [a, h, 0];
          q(b4, b3, r2, r1); q(b2, b1, r1, r2); t(b1, b4, r1); t(b3, b2, r2); P.setAttribute("position", new T.Float32BufferAttribute(v, 3)); return P; }
        case "wedge": { const a = p.sx / 2, b = p.sy / 2, h = p.sz, P = new T.BufferGeometry(), v = [];
          const q = (A, B, C, D) => v.push(...A, ...B, ...C, ...A, ...C, ...D), t = (A, B, C) => v.push(...A, ...B, ...C);
          const f1 = [-a, 0, -b], f2 = [-a, 0, b], k1 = [a, 0, -b], k2 = [a, 0, b], u1 = [a, h, -b], u2 = [a, h, b];
          q(f1, f2, u2, u1); q(k2, k1, u1, u2); t(f2, k2, u2); t(f1, u1, k1); P.setAttribute("position", new T.Float32BufferAttribute(v, 3)); return P; }
      }
    })();
    return g.index ? g.toNonIndexed() : g;
  }
  // one merged, vertex-coloured, flat-shaded geometry per kind; every vertex also carries the surface texture of its primitive (world.js TEX) and its position in the kind's own frame
  function kindGeometry(kind) {
    const pos = [], col = [], tex = [], tmp = new T.Color(), top = Math.max(kind.height, 1);
    for (const p of kind.prims) {
      const g = primGeo(p, kind); if (p.rot) g.rotateY(p.rot); g.translate(p.x, p.z, -p.y); g.computeVertexNormals();
      const a = g.attributes.position; tmp.setHex(p.c);
      for (let i = 0; i < a.count; i++) { const sh = 0.72 + 0.28 * Math.min(1, Math.max(0, a.getY(i)) / (0.55 * top)); pos.push(a.getX(i), a.getY(i), a.getZ(i)); col.push(tmp.r * sh, tmp.g * sh, tmp.b * sh); tex.push(p.tex || 0); }
      g.dispose();
    }
    const G = new T.BufferGeometry(); G.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); G.setAttribute("color", new T.Float32BufferAttribute(col, 3)); G.setAttribute("tex", new T.Float32BufferAttribute(tex, 1)); G.computeVertexNormals(); return addEdges(G);
  }
  // a unit-length rod hanging from the origin (for legs): scaled along y per instance
  function limbGeometry(t, c) {
    const g = new T.BoxGeometry(t, 1, t).translate(0, -0.5, 0).toNonIndexed(), n = g.attributes.position.count, col = [], tmp = new T.Color(c);
    for (let i = 0; i < n; i++) col.push(tmp.r, tmp.g, tmp.b); g.setAttribute("color", new T.Float32BufferAttribute(col, 3)); g.setAttribute("tex", new T.Float32BufferAttribute(new Float32Array(n), 1)); g.computeVertexNormals(); return addEdges(g);
  }

  // feature edges: a barycentric attribute per vertex plus a mask saying which of the triangle's three edges are creases (or open
  // borders); the fragment shader then draws those as thin lines, so quad diagonals and smooth facets stay clean
  function addEdges(G, creaseDeg = 16) {
    const P = G.attributes.position, n = P.count / 3, cosT = Math.cos(creaseDeg * Math.PI / 180), q = v => Math.round(v * 500), nrm = new Float32Array(n * 3), map = new Map();
    const key = (i, j) => { const a = `${q(P.getX(i))},${q(P.getY(i))},${q(P.getZ(i))}`, b = `${q(P.getX(j))},${q(P.getY(j))},${q(P.getZ(j))}`; return a < b ? a + "|" + b : b + "|" + a; };
    for (let t = 0; t < n; t++) { const i = 3 * t, ax = P.getX(i + 1) - P.getX(i), ay = P.getY(i + 1) - P.getY(i), az = P.getZ(i + 1) - P.getZ(i), bx = P.getX(i + 2) - P.getX(i), by = P.getY(i + 2) - P.getY(i), bz = P.getZ(i + 2) - P.getZ(i);
      let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx; const l = Math.hypot(x, y, z) || 1; nrm[3 * t] = x / l; nrm[3 * t + 1] = y / l; nrm[3 * t + 2] = z / l;
      for (let k = 0; k < 3; k++) { const kk = key(i + (k + 1) % 3, i + (k + 2) % 3); (map.get(kk) || map.set(kk, []).get(kk)).push([t, k]); } }
    const bary = new Float32Array(n * 9), em = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) bary[9 * t + 3 * k + k] = 1;
    for (const list of map.values()) { let feat = list.length !== 2; if (!feat) { const [a, b] = list; feat = nrm[3 * a[0]] * nrm[3 * b[0]] + nrm[3 * a[0] + 1] * nrm[3 * b[0] + 1] + nrm[3 * a[0] + 2] * nrm[3 * b[0] + 2] < cosT; }
      if (feat) for (const [t, k] of list) for (let v = 0; v < 3; v++) em[9 * t + 3 * v + k] = 1; }
    G.setAttribute("bary", new T.BufferAttribute(bary, 3)); G.setAttribute("emask", new T.BufferAttribute(em, 3)); return G;
  }
  // shared GLSL: an anti-aliased line at every multiple of P along a coordinate c (metres); it thins out and fades when cells shrink to a few pixels, so distant textures never shimmer
  const GLSL_LN = `float lnf(float c, float P) { float px = max(fwidth(c), 1e-5), d = abs(fract(c / P - 0.5) - 0.5) * P; return (1.0 - smoothstep(0.0, px * 1.3, d)) * (1.0 - smoothstep(0.1 * P, 0.3 * P, px)); }
    float lmk(float d, float w) { float px = max(fwidth(d), 1e-4); return 1.0 - smoothstep(w, w + px * 1.2, abs(d)); }`;
  const RADIALS = Array.from({ length: 4 }, () => null);   // road segments out to the districts (sim x y of both ends, as Vector4s), set once the world is known
  // objects ("edges"): Lambert faces in grey, crease lines, and per-primitive surface textures. terrain ("grid"): grey ground, a 2 m / 10 m grid, the street grid with its markings, the ring road and the roads out.
  function styled(kind) {
    const U = { uDark: { value: 0.6 }, uET: { value: new T.Color() }, uEAmt: { value: 0.85 }, uLw: { value: 1.0 }, uTxA: { value: 0.5 }, uTint: { value: new T.Color(1, 1, 1) }, uGrid: { value: new T.Color() }, uG1: { value: 0.2 }, uG2: { value: 0.4 }, uMk: { value: 0.9 }, uRoad: { value: 0.05 }, uWalk: { value: 0.2 }, uRad: { value: RADIALS.map(() => new T.Vector4()) }, uTime: { value: 0 }, uFd: { value: new T.Vector2(60, 160) } };
    const m = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }); m.userData.U = U;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      const decl = "uniform float uDark; uniform vec3 uET; uniform float uEAmt; uniform float uLw; uniform float uTxA; uniform vec3 uGrid; uniform vec3 uTint; uniform float uG1; uniform float uG2; uniform float uMk; uniform float uRoad; uniform float uWalk; uniform vec4 uRad[4]; uniform float uTime; uniform vec2 uFd;\n" + GLSL_LN;
      if (kind === "edges") {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 bary; attribute vec3 emask; attribute float tex; varying vec3 vBary; varying vec3 vEm; varying float vTex; varying vec3 vLP; varying vec3 vLN;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvBary = bary; vEm = emask; vTex = tex; vLP = position; vLN = normal;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vBary; varying vec3 vEm; varying float vTex; varying vec3 vLP; varying vec3 vLN; " + decl)
          .replace("#include <color_fragment>", `#include <color_fragment>
          float lum = pow(dot(diffuseColor.rgb, vec3(.3,.59,.11)), 0.78); diffuseColor.rgb = vec3(lum) * uDark;
          float tl = 0.0, pane = 0.0; int tx = int(vTex + 0.5);
          if (tx > 0) { vec3 n = normalize(vLN); float wall = step(abs(n.y), 0.5), slope = step(0.3, n.y) * step(n.y, 0.97), fadeD = 1.0 - smoothstep(uFd.x * 0.75, uFd.y * 0.66, length(vViewPosition));
            float u = abs(n.x) > abs(n.z) ? vLP.z : vLP.x, v = vLP.y;
            if (tx == 1) { vec2 q = vec2(u / 2.4, (v - 0.55) / 3.0), f = fract(q), fw = max(fwidth(q), vec2(1e-5));   // windows: a pane in every bay of every storey, framed
              float inX = step(0.2, f.x) * step(f.x, 0.8), inY = step(0.2, f.y) * step(f.y, 0.78), ok = wall * step(0.0, q.y) * (1.0 - smoothstep(0.1, 0.28, max(fw.x, fw.y * 0.8)));
              float eX = 1.0 - smoothstep(0.0, fw.x * 1.3, min(abs(f.x - 0.2), abs(f.x - 0.8))), eY = 1.0 - smoothstep(0.0, fw.y * 1.3, min(abs(f.y - 0.2), abs(f.y - 0.78)));
              tl = ok * max(eX * inY, eY * inX); pane = ok * inX * inY; }
            else if (tx == 2) tl = slope * lnf(vLP.z, 0.6);                       // roof: lines along the ridge
            else if (tx == 3) tl = lnf(v, 0.85);                                  // trees, tanks, domes: contour rings
            else if (tx == 4) { tl = wall * max(lnf(u, 1.5), lnf(v, 1.25)); pane = wall * 0.5; }   // curtain wall
            else if (tx == 5) tl = wall * lnf(v, 0.42);                           // planks, logs
            else if (tx == 6) tl = slope * lnf(vLP.x, 0.7);                       // ramp ribs
            tl *= fadeD; }
          diffuseColor.rgb *= 1.0 - 0.55 * pane;`)
          .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          { vec3 d = vBary / max(fwidth(vBary), vec3(1e-5)); float m = 1e3; if (vEm.x > .5) m = min(m, d.x); if (vEm.y > .5) m = min(m, d.y); if (vEm.z > .5) m = min(m, d.z);
            float ln = 1.0 - smoothstep(uLw - 0.4, uLw + 0.8, m); ln *= 1.0 - smoothstep(uFd.x, uFd.y, length(vViewPosition));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uET, max(ln * uEAmt, tl * uTxA)); }`);
      } else if (kind === "water") {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP; " + decl)
          .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          { vec2 p = vWP.xz; float r = sin(p.x * 0.42 + sin(p.y * 0.29 + uTime * 0.5) * 1.4 + uTime * 0.7) + sin(p.y * 0.5 - sin(p.x * 0.23 - uTime * 0.4) * 1.2 + uTime * 0.6) + 0.5 * sin((p.x + p.y) * 0.9 + uTime);
            float c = r * 1.1, dd = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), 1e-4), l = (1.0 - smoothstep(0.4, 1.4, dd)) * (1.0 - smoothstep(30.0, 130.0, length(vViewPosition)));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uET, l * 0.55); }`);
      } else {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP; " + decl)
          .replace("#include <color_fragment>", `#include <color_fragment>
          vec2 w = vec2(vWP.x, -vWP.z); float dist = length(vViewPosition), far = 1.0 - smoothstep(70.0, 160.0, dist);
          float inCity = step(max(abs(w.x), abs(w.y)), 91.0) * step(length(w), 98.0), mk = 0.0, walkM = 0.0, roadM = 0.0;
          vec2 uv = mod(w, 36.0) - 18.0, au = abs(uv); float rV = step(au.x, 6.0), rH = step(au.y, 6.0);        // uv: from the centre-line of the nearest street; V runs along y, H along x
          roadM = inCity * max(rV, rH);
          mk += inCity * rV * (1.0 - rH) * step(9.3, au.y) * step(fract(w.y / 6.0), 0.5) * lmk(uv.x, 0.09);   // dashed centre lines
          mk += inCity * rH * (1.0 - rV) * step(9.3, au.x) * step(fract(w.x / 6.0), 0.5) * lmk(uv.y, 0.09);
          mk += inCity * rV * step(6.3, au.y) * lmk(au.x - 5.5, 0.07) + inCity * rH * step(6.3, au.x) * lmk(au.y - 5.5, 0.07);   // lane edges
          mk += inCity * (rV * step(6.6, au.y) * step(au.y, 8.4) * step(au.x, 5.2) * step(fract(uv.x * 1.1), 0.5) + rH * step(6.6, au.x) * step(au.x, 8.4) * step(au.y, 5.2) * step(fract(uv.y * 1.1), 0.5));   // zebra crossings
          float sV = step(6.0, au.x) * step(au.x, 7.5), sH = step(6.0, au.y) * step(au.y, 7.5); walkM = inCity * max(sV, sH) * (1.0 - roadM);   // pavement along every kerb
          mk += inCity * (1.0 - roadM) * max(sV * max(lmk(au.x - 6.0, 0.06), lmk(au.x - 7.5, 0.05)), sH * max(lmk(au.y - 6.0, 0.06), lmk(au.y - 7.5, 0.05)));   // kerb and pavement edge
          mk += walkM * 0.8 * max(sV * lnf(w.y, 1.5), sH * lnf(w.x, 1.5));        // pavement joints
          float rr = length(w), rd = rr - 96.0; float ringM = step(abs(rd), 4.5);   // the ring road
          mk += ringM * (step(fract(atan(w.y, w.x) * 96.0 / 6.0), 0.5) * lmk(rd, 0.09) + lmk(abs(rd) - 4.0, 0.07));
          roadM = max(roadM, ringM);
          for (int i = 0; i < 4; i++) { vec2 a = uRad[i].xy, b = uRad[i].zw, ab = b - a; float L = length(ab), t = dot(w - a, ab) / (L * L); vec2 dir = ab / L, nrm = vec2(-dir.y, dir.x); float side = dot(w - a, nrm), along = t * L;   // roads out to the districts
            float on = step(0.0, t) * step(t, 1.0) * step(abs(side), 3.5); roadM = max(roadM, on);
            mk += on * (step(fract(along / 6.0), 0.5) * lmk(side, 0.09) + lmk(abs(side) - 3.1, 0.07)); }
          float lumv = dot(diffuseColor.rgb, vec3(.3,.59,.11)); diffuseColor.rgb = vec3(lumv) * uDark * uTint;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(uRoad), roadM); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(uWalk), walkM * (1.0 - roadM));`)
          .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          { vec2 p = vWP.xz, a = p / 2.0, b = p / 10.0; vec2 ga = abs(fract(a - 0.5) - 0.5) / max(fwidth(a), vec2(1e-5)), gb = abs(fract(b - 0.5) - 0.5) / max(fwidth(b), vec2(1e-5));
            float l1 = (1.0 - smoothstep(0.0, 1.2, min(ga.x, ga.y))) * (1.0 - smoothstep(35.0, 95.0, dist)), l2 = (1.0 - smoothstep(0.0, 1.5, min(gb.x, gb.y))) * (1.0 - smoothstep(90.0, 200.0, dist));
            float gm = (1.0 - 0.92 * roadM) * (1.0 - 0.6 * walkM);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uGrid, clamp((l1 * uG1 + l2 * uG2) * gm + clamp(mk, 0.0, 1.0) * far * uMk, 0.0, 1.0)); }`);
      }
    };
    return m;
  }

  // soft round point sprites with per-point alpha and size (wash particles and the trail)
  function pointsMaterial(additive) {
    return new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, uniforms: { scale: { value: 600 } },
      vertexShader: "attribute float size; attribute float alpha; attribute vec3 tint; attribute float ang; varying float vA; varying vec3 vC; varying float vR; uniform float scale; void main(){ vA=alpha; vC=tint; vR=ang; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(64.0,size*scale/max(0.1,-mv.z)); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "varying float vA; varying vec3 vC; varying float vR; void main(){ vec2 p=(gl_PointCoord-0.5)*2.0; float c=cos(vR), s=sin(vR); p=vec2(c*p.x-s*p.y, s*p.x+c*p.y); if(p.y<-0.5 || abs(p.x)>(0.9-p.y)*0.557) discard; gl_FragColor=vec4(vC,vA); }" });
  }
  function pointCloud(max, additive) {
    const g = new T.BufferGeometry(), P = new Float32Array(max * 3), S = new Float32Array(max), A = new Float32Array(max), C = new Float32Array(max * 3);
    g.setAttribute("position", new T.BufferAttribute(P, 3)); g.setAttribute("size", new T.BufferAttribute(S, 1)); g.setAttribute("alpha", new T.BufferAttribute(A, 1)); g.setAttribute("tint", new T.BufferAttribute(C, 3));
    const R = new Float32Array(max); for (let k = 0; k < max; k++) R[k] = Math.random() * 6.283; g.setAttribute("ang", new T.BufferAttribute(R, 1));   // each triangle has its own fixed turn
    g.setDrawRange(0, 0); const m = new T.Points(g, pointsMaterial(additive)); m.frustumCulled = false; return { m, g, P, S, A, C };
  }

  async function create(canvas, overlay, world) {
    await loadThree();
    const W = world, H = W.H, d3 = (x, y, z) => new T.Vector3(x, z, -y);   // sim → three
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(55, 1, 0.15, 300);
    const hemi = new T.HemisphereLight(0xffffff, 0x444444, 1), sun = new T.DirectionalLight(0xffffff, 2); sun.position.set(-0.55, 0.62, 0.45).multiplyScalar(300); scene.add(hemi, sun);
    scene.fog = new T.Fog(0xffffff, 26, 170);   // thick enough that the world's end (and the skirt beyond it) dissolves into the horizon
    // ---- sky ----
    const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new T.Color() }, mid: { value: new T.Color() }, hor: { value: new T.Color() }, sunC: { value: new T.Color() }, sunD: { value: sun.position.clone().normalize() } },
      vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunC; uniform vec3 sunD; varying vec3 vD; void main(){ float h=max(vD.y,0.0); vec3 c=mix(hor,mid,smoothstep(0.0,0.25,h)); c=mix(c,top,smoothstep(0.2,0.9,h)); float s=max(dot(vD,sunD),0.0); c+=sunC*(pow(s,48.0)*0.9+pow(s,6.0)*0.18); gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n }" });
    const sky = new T.Mesh(new T.SphereGeometry(250, 24, 12), skyMat); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
    // ---- terrain: a 2 m grid of flat triangles, each one grey by what it is (ground type, slope, height); the last 14 m taper down to a skirt so the edge never shows.
    // Triangle colours are per face, not blended between vertices, so the kerb of a block and the edge of a field are crisp. Roads themselves are drawn by the shader (analytic, so lane lines stay sharp at any distance). ----
    const HALF = 150, STEP = 2, NV = HALF * 2 / STEP + 1, SKIRT = -14;
    const vis = (x, y) => { const e = sstep(HALF - 14, HALF, Math.max(Math.abs(x), Math.abs(y))); return H(x, y) * (1 - e) + SKIRT * e; };
    const GRAYS = new Map([[0x4b4e56, 0.2], [0xb9b4a8, 0.68], [0x9b9fa6, 0.52], [0x5c9f48, 0.30], [0x7e848c, 0.50], [0x6a9a58, 0.40], [0x7e8f5c, 0.43], [0x8f8a80, 0.54], [0x9db35a, 0.48], [0x7f9b4a, 0.34]]);
    const grayAt = (x, y, h, sl) => {
      const n = (Math.sin(x * 0.21 + y * 0.13) + Math.sin(x * 0.07 - y * 0.19)) * 0.25 + 0.5; let g = 0.30 + 0.07 * n + 0.05 * sstep(5, 12, h);
      if (sl > 0.5) g += (0.52 - g) * Math.min(1, (sl - 0.5) * 3);
      if (h < W.waterY + 1.4) g += (0.66 - g) * sstep(W.waterY + 1.4, W.waterY + 0.2, h);
      const gnd = W.groundAt(x, y); if (gnd) g += ((GRAYS.get(gnd[0]) ?? 0.4) - g) * gnd[1]; return g; };
    const hts = new Float32Array(NV * NV); for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) hts[j * NV + i] = vis(-HALF + i * STEP, -HALF + j * STEP);
    const nTri = (NV - 1) * (NV - 1) * 2, tp = new Float32Array(nTri * 9), tc = new Float32Array(nTri * 9); let tq = 0;
    for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NV - 1; i++) {
      const a = [i, j], b = [i + 1, j], c = [i, j + 1], d = [i + 1, j + 1];
      for (const tri of [[a, b, c], [b, d, c]]) {
        const cx = -HALF + STEP * (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = -HALF + STEP * (tri[0][1] + tri[1][1] + tri[2][1]) / 3, h = (hts[tri[0][1] * NV + tri[0][0]] + hts[tri[1][1] * NV + tri[1][0]] + hts[tri[2][1] * NV + tri[2][0]]) / 3;
        const sl = Math.hypot(vis(cx + 1.5, cy) - vis(cx - 1.5, cy), vis(cx, cy + 1.5) - vis(cx, cy - 1.5)) / 3, g = grayAt(cx, cy, h, sl);
        for (const [ii, jj] of tri) { tp[tq] = -HALF + ii * STEP; tp[tq + 1] = hts[jj * NV + ii]; tp[tq + 2] = HALF - jj * STEP; tc[tq] = tc[tq + 1] = tc[tq + 2] = g; tq += 3; } } }
    const tgf = new T.BufferGeometry(); tgf.setAttribute("position", new T.BufferAttribute(tp, 3)); tgf.setAttribute("color", new T.BufferAttribute(tc, 3)); tgf.computeVertexNormals();
    const mat = styled("edges"), matT = styled("grid"), matW = styled("water");
    (W.radials || []).forEach((r, i) => matT.userData.U.uRad.value[i].set(r[0], r[1], r[2], r[3]));
    const terrain = new T.Mesh(tgf, matT); scene.add(terrain);
    const skirt = new T.Mesh(new T.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2).translate(0, SKIRT - 0.3, 0), new T.MeshBasicMaterial({ color: 0x5c7a50 })); scene.add(skirt);
    matW.transparent = true; matW.opacity = 0.93; matW.vertexColors = false;
    const water = new T.Mesh(new T.PlaneGeometry(2 * HALF, 2 * HALF).rotateX(-Math.PI / 2).translate(0, W.waterY, 0), matW); scene.add(water);
    // ---- objects: one InstancedMesh per kind ----
    const meshes = [], by = new Map(); W.insts.forEach(it => (by.get(it.ki) || by.set(it.ki, []).get(it.ki)).push(it));
    const M4 = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S3 = new T.Vector3(), UP = new T.Vector3(0, 1, 0), tint = new T.Color();
    for (const [ki, list] of by) {
      const geo = kindGeometry(W.kinds[ki]), im = new T.InstancedMesh(geo, mat, list.length);
      list.forEach((it, n) => { Q.setFromAxisAngle(UP, it.rot); V.set(it.x, it.z, -it.y); S3.setScalar(it.s); M4.compose(V, Q, S3); im.setMatrixAt(n, M4); tint.setRGB(it.tint, it.tint, it.tint); im.setColorAt(n, tint); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); meshes.push(im);
    }
    // ---- people and traffic: cars by kind, pedestrians (a body and two swinging legs each) and cyclists (a bike, two wheels that turn, two legs on the pedals), moved every frame along their routes ----
    const AGS = W.agents || [], AG = { cars: [], w: null, b: null };
    const mkIM = (geo, n) => { const im = new T.InstancedMesh(geo, mat, Math.max(1, n)); im.count = n; im.frustumCulled = false; scene.add(im); meshes.push(im); return im; };
    const tints = (im, list) => list.forEach((a, n) => { tint.setRGB(a.tint, a.tint, a.tint); im.setColorAt(n, tint); });
    {
      const byKi = new Map(); AGS.forEach(a => { if (a.type === "car") (byKi.get(a.ki) || byKi.set(a.ki, []).get(a.ki)).push(a); });
      for (const [ki, list] of byKi) { const im = mkIM(kindGeometry(W.kinds[ki]), list.length); tints(im, list); AG.cars.push({ im, list }); }
      const wk = AGS.filter(a => a.type === "walker"), bk = AGS.filter(a => a.type === "bike"), wd = WORLD_AGENTS.walker, bd = WORLD_AGENTS.bike;
      AG.w = { list: wk, body: mkIM(kindGeometry({ prims: wd.prims, height: 1.8 }), wk.length), legs: mkIM(limbGeometry(wd.legs.t, wd.legs.c), wk.length * 2) }; tints(AG.w.body, wk); tints(AG.w.legs, [...wk, ...wk]);
      const wr = bd.wheels.r, wheelGeo = kindGeometry({ height: 0.7, prims: [{ k: "tor", x: 0, y: 0, z: -wr, R: wr, t: 0.022, c: 0x2a2d33 }, { k: "rod", x: 0, y: 0, z: 0, dx: 2 * wr, dy: 0, dz: 0, t: 0.012, c: 0x555a62 }, { k: "rod", x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 2 * wr, t: 0.012, c: 0x555a62 }] });
      AG.b = { list: bk, body: mkIM(kindGeometry({ prims: bd.prims, height: 1.5 }), bk.length), wheels: mkIM(wheelGeo, bk.length * 2), legs: mkIM(limbGeometry(bd.legs.t, bd.legs.c), bk.length * 2) }; tints(AG.b.body, bk);
    }
    const poseO = {}, Ma = new T.Matrix4(), Mh = new T.Matrix4(), Qd = new T.Quaternion(), V1 = new T.Vector3(), V2 = new T.Vector3(), V3 = new T.Vector3(), DOWN = new T.Vector3(0, -1, 0), EULZ = new T.Euler();
    const place = (a, clock, lift = 0) => { W.agentPose(a, clock, poseO); Q.setFromAxisAngle(UP, poseO.yaw); V.set(poseO.x, poseO.z + lift, -poseO.y); S3.setScalar(a.scale || 1); Ma.compose(V, Q, S3); return poseO; };
    // a limb is a unit rod hanging from its hip; this scales and turns it so it reaches from hip to foot (both in the agent's own frame: three x, z up → y, −y → z)
    const limb = (im, k, hx, hy, hz, fx, fy, fz) => { V1.set(fx - hx, fy - hy, fz - hz); const len = V1.length() || 1e-3; V1.multiplyScalar(1 / len); Qd.setFromUnitVectors(DOWN, V1); Mh.compose(V2.set(hx, hy, hz), Qd, V3.set(1, len, 1)); M4.multiplyMatrices(Ma, Mh); im.setMatrixAt(k, M4); };
    const moveAgents = clock => {
      for (const { im, list } of AG.cars) { list.forEach((a, n) => { place(a, clock); im.setMatrixAt(n, Ma); }); im.instanceMatrix.needsUpdate = true; }
      { const g = AG.w, L = WORLD_AGENTS.walker.legs, hips = L.hip;
        g.list.forEach((a, n) => { const p = place(a, clock), ph = p.s * 2 * Math.PI / 1.4 + a.s0, sw = 0.55 * Math.sin(ph); Ma.elements[13] += 0.025 * Math.abs(Math.sin(ph)) * (a.scale || 1); g.body.setMatrixAt(n, Ma);
          hips.forEach((h, k) => { const th = k ? -sw : sw, hx = h[0], hy = h[2], hz = -h[1]; limb(g.legs, 2 * n + k, hx, hy, hz, hx + Math.sin(th) * L.len, hy - Math.cos(th) * L.len + (th < 0 ? 0 : 0.03), hz); }); });
        g.body.instanceMatrix.needsUpdate = g.legs.instanceMatrix.needsUpdate = true; }
      { const g = AG.b, B = WORLD_AGENTS.bike, wr = B.wheels.r, C = B.legs.crank;
        g.list.forEach((a, n) => { const p = place(a, clock); g.body.setMatrixAt(n, Ma); const spin = -p.s / wr, ph = p.s / 3.2 * 2 * Math.PI;
          B.wheels.at.forEach((w, k) => { Q.setFromAxisAngle(V1.set(0, 0, 1), spin); Mh.compose(V2.set(w[0], w[2], -w[1]), Q, V3.set(1, 1, 1)); M4.multiplyMatrices(Ma, Mh); g.wheels.setMatrixAt(2 * n + k, M4); });
          B.legs.hip.forEach((h, k) => { const a2 = ph + k * Math.PI; limb(g.legs, 2 * n + k, h[0], h[2], -h[1], C[0] + B.legs.cr * Math.cos(a2), C[2] + B.legs.cr * Math.sin(a2), (k ? 1 : -1) * B.legs.off); }); });
        g.body.instanceMatrix.needsUpdate = g.wheels.instanceMatrix.needsUpdate = g.legs.instanceMatrix.needsUpdate = true; }
    };
    moveAgents(0);
    // ---- the quad (built in the body frame: x forward, y left, z up → three x, −z, y) ----
    const quad = new T.Group(), body = new T.Group(); quad.add(body); scene.add(quad);
    const mk = (geo, color, o = {}) => { const m = new T.Mesh(geo, o.basic ? new T.MeshBasicMaterial({ color, ...o.mat }) : new T.MeshLambertMaterial({ color, flatShading: true, ...o.mat })); return m; };
    const bx = (sx, sy, sz, x, y, z, color, o) => { const m = mk(new T.BoxGeometry(sx, sz, sy), color, o); m.position.set(x, z, -y); body.add(m); return m; };
    const frame = [];
    frame.push(bx(0.16, 0.062, 0.004, 0, 0, 0, 0x22252b), bx(0.16, 0.062, 0.004, 0, 0, 0.032, 0x22252b), bx(0.1, 0.042, 0.034, -0.015, 0, 0.036, 0x2a2d35));
    const fcBlock = bx(0.044, 0.044, 0.028, -0.01, 0, 0.004, 0xffffff, { basic: true });
    bx(0.034, 0.034, 0.034, 0.088, 0, 0.012, 0x15171b); const camLens = bx(0.006, 0.026, 0.026, 0.107, 0, 0.012, 0xffffff, { basic: true });
    const armGeo = new T.BoxGeometry(0.158, 0.004, 0.018);
    MPOS3.forEach(([x, y]) => { const a = mk(armGeo, 0x2b2e35); a.position.set(x / 2, 0.015, -y / 2); a.rotation.y = Math.atan2(y, x); body.add(a); frame.push(a); });
    const motors = [], discs = [], blades = [], leds = [];
    MPOS3.forEach(([x, y], m) => {
      const mo = mk(new T.CylinderGeometry(0.014, 0.014, 0.022, 14), 0xffffff, { mat: { emissive: 0x222222 } }); mo.position.set(x, 0.027, -y); body.add(mo); motors.push(mo);
      const di = mk(new T.CircleGeometry(0.0889, 28).rotateX(-Math.PI / 2), 0xffffff, { basic: true, mat: { transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false } }); di.position.set(x, 0.044, -y); body.add(di); discs.push(di);
      const bl = mk(new T.BoxGeometry(0.178, 0.0016, 0.011), 0x14161a, { basic: true, mat: { transparent: true, opacity: 0.75 } }); bl.position.set(x, 0.046, -y); body.add(bl); blades.push(bl);
      const le = mk(new T.SphereGeometry(0.006, 8, 6), 0xffffff, { basic: true }); le.position.set(x * 1.12, 0.018, -y * 1.12); body.add(le); leds.push(le);
    });
    quad.scale.setScalar(QS);
    const shadow = new T.Mesh(new T.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false })); shadow.renderOrder = 1; scene.add(shadow);
    const NPART = 3600, wash = { P: new Float32Array(NPART * 6), C: new Float32Array(NPART * 6), g: new T.BufferGeometry() };   // the prop wash is drawn as short streaks (tail → head along each particle's velocity)
    wash.g.setAttribute("position", new T.BufferAttribute(wash.P, 3)); wash.g.setAttribute("color", new T.BufferAttribute(wash.C, 3)); wash.g.setDrawRange(0, 0);
    wash.m = new T.LineSegments(wash.g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })); wash.m.frustumCulled = false; scene.add(wash.m);
    const TRN = 420, TNV = (TRN + 1) * 2, tg_ = new T.BufferGeometry(), trail = { P: new Float32Array(TNV * 3), A: new Float32Array(TNV), C: new Float32Array(TNV * 3), S: new Float32Array(TNV), g: tg_ };   // the trail is a ribbon that always faces the camera: thick next to the quad, thinning and fading to its tail
    { const ix = new Uint16Array(TRN * 6); for (let k = 0; k < TRN; k++) { const a = 2 * k; ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k * 6); } tg_.setIndex(new T.BufferAttribute(ix, 1)); }
    tg_.setAttribute("position", new T.BufferAttribute(trail.P, 3)); tg_.setAttribute("alpha", new T.BufferAttribute(trail.A, 1)); tg_.setAttribute("tint", new T.BufferAttribute(trail.C, 3)); tg_.setAttribute("side", new T.BufferAttribute(trail.S, 1)); tg_.setDrawRange(0, 0);
    trail.m = new T.Mesh(tg_, new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, vertexShader: "attribute float alpha; attribute float side; attribute vec3 tint; varying float vA; varying float vS; varying vec3 vC; void main(){ vA=alpha; vC=tint; vS=side; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying float vA; varying float vS; varying vec3 vC; void main(){ gl_FragColor=vec4(vC, vA*(1.0-smoothstep(0.5,1.0,abs(vS)))); }" })); trail.m.frustumCulled = false; trail.m.renderOrder = 2; scene.add(trail.m);
    // ---- palette ----
    let curTheme = "", SEQ = seqStops();
    const applyTheme = () => { const th = theme(); if (th === curTheme) return; curTheme = th; const P = PAL[th], dark = th === "dark";
      skyMat.uniforms.top.value.setHex(P.top); skyMat.uniforms.mid.value.setHex(P.mid); skyMat.uniforms.hor.value.setHex(P.hor); skyMat.uniforms.sunC.value.setHex(P.sun).multiplyScalar(dark ? 0.5 : 0.3);
      scene.fog.color.setHex(P.fog); hemi.color.setHex(P.hemiS); hemi.groundColor.setHex(P.hemiG); hemi.intensity = P.hemiI; sun.color.setHex(P.sun); sun.intensity = P.sunI; water.material.color.setHex(P.water);
      const UO = mat.userData.U, UT = matT.userData.U, UW = matW.userData.U;
      UO.uDark.value = P.oDark; UO.uET.value.setHex(P.eTint); UO.uEAmt.value = P.eAmt; UO.uTxA.value = P.txA; UO.uLw.value = 1.0 * Math.min(devicePixelRatio || 1, 2);
      UT.uDark.value = P.tDark; UT.uGrid.value.setHex(P.grid); UT.uG1.value = P.g1; UT.uG2.value = P.g2; UT.uMk.value = P.mk; UT.uRoad.value = P.road; UT.uWalk.value = P.walk; UW.uET.value.setHex(P.ink);
      SEQ = seqStops(); frame.forEach(m => seqAt(SEQ, dark ? 0.55 : 0.8, m.material.color)); [fcBlock, camLens, ...leds].forEach(m => seqAt(SEQ, 1, m.material.color));
      skirt.material.color.setHex(dark ? 0x0b0b0b : 0xe4e4e4); shadow.material.color.setHex(dark ? 0x000000 : 0x303030); wash.m.material.blending = trail.m.material.blending = dark ? T.AdditiveBlending : T.NormalBlending; };
    // ---- per-frame state ----
    const st = { cam: {}, blade: [0, 0, 0, 0], ptime: 0, parts: [], tr: [], lastT: -1, key: null };
    let cw = 0, ch = 0;
    const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2); if (w === cw && h === ch) return; cw = w; ch = h; renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
      if (overlay) { overlay.width = w * dpr; overlay.height = h * dpr; } };
    const qrotV = (q, v) => { const [w, x, y, z] = q; return [(1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2], 2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2], 2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2]]; };
    const spdCol = new T.Color(), c0 = new T.Color(), tone = g => seqAt(SEQ, curTheme === "dark" ? 0.35 + 0.65 * g : 0.45 + 0.55 * g, spdCol);   // brightness 0…1 against the world: light on dark, ink on paper
    const gauss = () => { let u = 0; for (let k = 0; k < 4; k++) u += Math.random(); return (u - 2) * 1.73; };

    function draw(t, o, d) {
      resize(); applyTheme(); { const ck = o.clk ?? t; matW.userData.U.uTime.value = ck; moveAgents(ck); }
      const i = idxAt(t), n = d.n, j = Math.max(1, Math.min(n - 1, i)), f = Math.max(0, Math.min(1, (t - d.t[j - 1]) / ((d.t[j] - d.t[j - 1]) || 1)));
      const P = [0, 1, 2].map(k => d.pos[k][j - 1] + (d.pos[k][j] - d.pos[k][j - 1]) * f), q = quatAt(d.q[o.src || "filt"], d, t, i);
      const dtl = t - (st.lastT < 0 ? t : st.lastT), fresh = st.key !== d || !(dtl >= 0 && dtl < 0.5); if (fresh) { st.parts.length = 0; st.tr.length = 0; st.cam = {}; st.key = d; }
      st.lastT = t;
      const dtLog = fresh ? 0 : Math.max(0, Math.min(0.1, dtl)), dtReal = Math.min(0.1, Math.max(0.001, o.dtReal ?? 0.016));
      // quad pose
      quad.position.copy(d3(P[0], P[1], P[2]));
      body.quaternion.set(q[1], q[3], -q[2], q[0]);   // sim (w; x y z) → three (x, z, −y)
      const sh = qrotV(q, [0, 1, 2].map(a => d.disp[a][i] * 3)); body.position.set(sh[0], sh[2], -sh[1]);
      const hz = [0, 1, 2, 3].map(m => d.ch[`mHz[${m}]`][i]), mp = [0, 1, 2, 3].map(m => d.ch[`m%[${m}]`][i]);
      if (PB.playing || dtLog > 0) for (let m = 0; m < 4; m++) st.blade[m] += SPIN3[m] * hz[m] * 0.04 * (o.dt || 0) * 2 * Math.PI;
      for (let m = 0; m < 4; m++) { const g = 0.25 + 0.75 * Math.min(1, hz[m] / d.fmax), c = tone(g); motors[m].material.color.copy(c); motors[m].material.emissive.copy(c).multiplyScalar(0.35); discs[m].material.color.copy(c); blades[m].rotation.y = st.blade[m]; }   // grey: the faster a motor spins, the brighter
      // shadow on the ground, on the slope
      const gz = H(P[0], P[1]), e = 1.2, nx = H(P[0] - e, P[1]) - H(P[0] + e, P[1]), ny = H(P[0], P[1] - e) - H(P[0], P[1] + e), hgt = Math.max(0, P[2] - gz);
      shadow.position.set(P[0], gz + 0.12, -P[1]); shadow.quaternion.setFromUnitVectors(UP, new T.Vector3(nx / (2 * e), 1, -ny / (2 * e)).normalize());
      shadow.scale.setScalar((0.9 + hgt * 0.06) * QS * 0.45); shadow.material.opacity = 0.3 / (1 + hgt / 10);
      // wash particles: air pushed out along each prop's thrust axis (visual space: the quad is drawn QS× bigger, so the jet is too)
      const PS = st.parts, vq = (() => { const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), fs = n / d.dur; return [0, 1, 2].map(k => (d.pos[k][i1] - d.pos[k][i0]) * fs / Math.max(1, i1 - i0)); })();
      const zb = qrotV(q, [0, 0, 1]), LIFE = 0.9;
      const step = (pt, h, TT) => { const [x, y, z] = pt.p, A = 0.9 * Math.min(1, pt.age * 2.5) * (0.3 + pt.th);
        const ed = [Math.sin(1.7 * y + TT * 1.3 + pt.ph) - Math.sin(1.3 * z + TT * 0.9), Math.sin(1.5 * z + TT * 1.1 + pt.ph) - Math.sin(1.9 * x + TT * 1.5), Math.sin(1.6 * x + TT * 0.7) - Math.sin(1.4 * y + TT * 1.2 + pt.ph)];
        const sp = Math.hypot(...pt.v), dr = Math.exp(-h * (1.4 + 0.12 * sp)), sig = (0.3 + 2.0 * pt.age) * Math.sqrt(h);
        for (let a = 0; a < 3; a++) { pt.v[a] = pt.v[a] * dr + A * ed[a] * h * 5 + gauss() * sig; pt.p[a] += pt.v[a] * h; } };
      if (o.particles && dtLog > 0) {
        st.ptime += dtLog;
        for (let k = PS.length - 1; k >= 0; k--) { const pt = PS[k]; pt.age += dtLog; if (pt.age > LIFE) { PS.splice(k, 1); continue; } step(pt, dtLog, st.ptime); }
        MPOS3.forEach(([x, y], m) => { const th = Math.max(0, Math.min(1, mp[m] / 100)) ** 1.4, nNew = Math.floor((20 + 1100 * th) * dtLog + Math.random());
          for (let k = 0; k < nNew && PS.length < NPART; k++) { const a = Math.random() * 2 * Math.PI, r = (0.2 + Math.random() * 0.7) * 0.0889, jet = 34 * Math.pow(th, 0.75) * (0.75 + Math.random() * 0.5) * QS * 0.5 + 1.5, sw = SPIN3[m] * 0.4 * jet;
            const lp = qrotV(q, [(x + r * Math.cos(a)) * QS, (y + r * Math.sin(a)) * QS, -0.01 * QS]), tg = qrotV(q, [-Math.sin(a) * sw, Math.cos(a) * sw, 0]);
            const pt = { p: [P[0] + lp[0], P[1] + lp[1], P[2] + lp[2]], age: 0, th, ph: Math.random() * 6.28, v: [0, 1, 2].map(c => vq[c] - zb[c] * jet + tg[c] + (Math.random() - 0.5) * (0.6 + 3 * th)) };
            const fb = Math.random() * dtLog; for (let c = 0; c < 3; c++) pt.p[c] -= vq[c] * fb; pt.age = fb; step(pt, fb, st.ptime); PS.push(pt); } });
      } else if (!o.particles) PS.length = 0;
      const dark = curTheme === "dark";
      { const bg = dark ? 0 : 1, cl = dark ? 0.92 : 0.12, vis = o.cam === "flight" ? 0.35 : 1;
        for (let k = 0; k < PS.length; k++) { const pt = PS[k], life = 1 - pt.age / LIFE, b = k * 6, sp = Math.hypot(pt.v[0] - vq[0], pt.v[1] - vq[1], pt.v[2] - vq[2]) || 1, L = Math.min(0.5 * QS, 0.012 * sp * QS + 0.03), f = Math.max(0, life) * (0.35 + 0.65 * pt.th) * vis;
          wash.P[b] = pt.p[0]; wash.P[b + 1] = pt.p[2]; wash.P[b + 2] = -pt.p[1];
          wash.P[b + 3] = pt.p[0] - (pt.v[0] - vq[0]) / sp * L; wash.P[b + 4] = pt.p[2] - (pt.v[2] - vq[2]) / sp * L; wash.P[b + 5] = -(pt.p[1] - (pt.v[1] - vq[1]) / sp * L);
          const hc = bg + (cl - bg) * f * 0.75, tc = bg + (cl - bg) * f * 0.1; wash.C[b] = wash.C[b + 1] = wash.C[b + 2] = hc; wash.C[b + 3] = wash.C[b + 4] = wash.C[b + 5] = tc; }
        wash.g.setDrawRange(0, PS.length * 2); wash.g.attributes.position.needsUpdate = true; wash.g.attributes.color.needsUpdate = true; }
      // trail: the last ~3.5 s of the path
      const TR = st.tr; if (o.trail) { if (dtLog > 0 && (!TR.length || Math.hypot(P[0] - TR[TR.length - 1][0], P[1] - TR[TR.length - 1][1], P[2] - TR[TR.length - 1][2]) > 0.3)) { TR.push([P[0], P[1], P[2], t]); } while (TR.length && (t - TR[0][3] > 4 || TR.length > TRN - 1)) TR.shift(); } else TR.length = 0;
      seqAt(SEQ, dark ? 0.7 : 0.7, c0);
      { const nP = TR.length + 1, V = new Array(nP), cp = cam.position;   // points in three space, the head last (joined to the quad)
        for (let k = 0; k < nP; k++) V[k] = k < TR.length ? [TR[k][0], TR[k][2], -TR[k][1]] : [P[0], P[2], -P[1]];
        for (let k = 0; k < nP; k++) {
          const a = k < TR.length ? Math.max(0, 1 - (t - TR[k][3]) / 4) : 1, p0 = V[Math.max(0, k - 1)], p1 = V[Math.min(nP - 1, k + 1)], tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2],
            vx = cp.x - V[k][0], vy = cp.y - V[k][1], vz = cp.z - V[k][2];
          let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx; const sl = Math.hypot(sx, sy, sz) || 1, w = (0.02 + 0.09 * a * a) * (QS / 5) * 2.2 / 2 / sl; sx *= w; sy *= w; sz *= w;   // half-width in metres: 0.39 m at the quad, 0.05 m at the tail
          for (let s = 0; s < 2; s++) { const v = 2 * k + s, b = v * 3, sg = s ? 1 : -1; trail.P[b] = V[k][0] + sx * sg; trail.P[b + 1] = V[k][1] + sy * sg; trail.P[b + 2] = V[k][2] + sz * sg; trail.S[v] = sg;
            trail.A[v] = k < TR.length ? a * 0.4 : 0.5; trail.C[b] = c0.r; trail.C[b + 1] = c0.g; trail.C[b + 2] = c0.b; } }
        trail.g.setDrawRange(0, TR.length ? (nP - 1) * 6 : 0); for (const a of ["position", "alpha", "tint", "side"]) trail.g.attributes[a].needsUpdate = true; }
      // ---- camera ----
      const cs = st.cam, fx = qrotV(q, [1, 0, 0]), heading = Math.atan2(fx[1], fx[0]), ground = (x, y) => Math.max(H(x, y), W.topAt(x, y) > -1e8 ? W.topAt(x, y) : -1e9);
      let Es, Ts = [P[0], P[1], P[2]], fov = 55, camQ = null;
      if (o.cam === "flight") {   // FPV: on the quad's nose, tilted up 25°
        const nose = qrotV(q, [0.1 * QS * 0.35, 0, 0.02 * QS * 0.35]); Es = [P[0] + nose[0], P[1] + nose[1], P[2] + nose[2]];
        const tilt = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 25 * Math.PI / 180);   // about the body's left axis (three z): nose up
        camQ = body.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, -1), 0)).multiply(tilt); fov = 112;
        const sk = qrotV(q, [0, 1, 2].map(a => d.disp[a][i] * 40)); Es = [Es[0] + sk[0], Es[1] + sk[1], Es[2] + sk[2]];
      } else if (o.cam === "world") {   // wide: a spotter standing off, drifting round, with some lag
        const R = 7 * o.dist * (0.4 + QS / 8), el = 0.3 + (o.el - 0.28), az0 = 0.6 + (o.az - 3.69) + (o.clk ?? t) * 0.035, at = a => [P[0] + Math.cos(a) * R * Math.cos(el), P[1] + Math.sin(a) * R * Math.cos(el), P[2] + R * Math.sin(el) + 2];
        const clear = g => { for (let k = 1; k <= 7; k++) { const f = k / 8; if (W.sdf(P[0] + (g[0] - P[0]) * f, P[1] + (g[1] - P[1]) * f, P[2] + (g[2] - P[2]) * f) < 1.6) return false; } return true; };
        if (cs.wo === undefined || fresh) cs.wo = 0; if (!clear(at(az0 + cs.wo)) && (cs.wt = (cs.wt || 0) + dtLog) > 0.15) { cs.wt = 0; for (const off of [0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, 3.1]) if (clear(at(az0 + cs.wo + off))) { cs.wo += off; break; } }
        const goal = at(az0 + cs.wo);
        if (!cs.w || fresh) cs.w = goal.slice(); const a = 1 - Math.exp(-dtLog / 0.9); for (let k = 0; k < 3; k++) cs.w[k] += (goal[k] - cs.w[k]) * a;
        Es = cs.w.slice(); fov = 38;
      } else {   // chase: behind and above, heading and tilt smoothed in log time
        const zbq = zb; if (cs.yaw === undefined || fresh) { cs.yaw = heading; cs.up = [0, 0, 1]; }
        else if (dtLog > 0) { const hz_ = Math.hypot(fx[0], fx[1]), conf = Math.min(1, hz_ / 0.5) * Math.max(0, Math.min(1, zbq[2] * 2.5)); let dy = heading - cs.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          const stp = dy * (1 - Math.exp(-dtLog * conf / 0.5)), mx = 2.6 * dtLog; cs.yaw += Math.max(-mx, Math.min(mx, stp));
          const k = 0.22, goal = [k * zbq[0], k * zbq[1], 1 - k + k * zbq[2]], a = 1 - Math.exp(-dtLog / 0.18); cs.up = cs.up.map((v, jj) => v + (goal[jj] - v) * a); }
        const az = cs.yaw + Math.PI + (o.az - 3.69), el = 0.3 + (o.el - 0.28), R = o.dist * 0.5 * QS, off = [Math.cos(az) * R * Math.cos(el), Math.sin(az) * R * Math.cos(el), R * Math.sin(el)];
        Es = [P[0] + off[0], P[1] + off[1], P[2] + off[2]];
      }
      if (o.dbgCam) { Es = o.dbgCam.e.slice(); Ts = o.dbgCam.t.slice(); fov = o.dbgCam.fov || 40; camQ = null; }   // test hook: look at any point of the world
      // keep the camera out of the ground and out of walls: lift, then slide towards the quad
      if (o.cam !== "flight" && !o.dbgCam) { for (let it = 0; it < 6 && W.sdf(Es[0], Es[1], Es[2]) < 1.3; it++) { Es[2] = Math.max(Es[2], ground(Es[0], Es[1]) + 1.4); if (W.sdf(Es[0], Es[1], Es[2]) < 1.3) for (let k = 0; k < 3; k++) Es[k] += (Ts[k] - Es[k]) * 0.25; } Es[2] = Math.max(Es[2], H(Es[0], Es[1]) + 1.2); }
      cam.fov = fov; cam.updateProjectionMatrix(); cam.position.copy(d3(Es[0], Es[1], Es[2]));
      if (camQ) cam.quaternion.copy(camQ).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2 * 0)); else cam.lookAt(d3(Ts[0], Ts[1] + 0, Ts[2] + 0.3));
      if (o.cam === "flight") { // the body frame has +x forward (three +x); a three camera looks down −z: turn it
        cam.quaternion.copy(camQ).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI / 2)); }
      sky.position.copy(cam.position);
      quad.visible = o.cam !== "flight"; shadow.visible = quad.visible || true;
      renderer.render(scene, cam);
      return { speed: Math.hypot(...vq), alt: P[2] - gz };
    }
    const dispose = () => { try { for (const m of meshes) { m.geometry.dispose(); m.dispose(); } terrain.geometry.dispose(); mat.dispose(); matT.dispose(); wash.g.dispose(); trail.g.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { console.warn(e); } };
    // the flight carries on in a new data set with a shifted clock: keep the trail, camera and particles
    const rebase = (d, off) => { st.key = d; st.lastT -= off; for (const p of st.tr) p[3] -= off; };
    return { draw, rebase, dispose, resize: () => { cw = 0; resize(); }, canvas };
  }
  const supported = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } };
  return { create, supported, _dbg: { kindGeometry, limbGeometry, styled, loadThree, PAL, QS } };   // _dbg: for the shape-audit page in the test tools
})();
