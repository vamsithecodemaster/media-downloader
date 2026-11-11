// Three equal-mass stars + K massless planets circling the whole triple. RK4, G = 1.
// The step depends only on the stars (capped small), so stars and each planet are
// independent of which other planets are in the run.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function initialStars(seed) {
  const rnd = mulberry32(seed), s = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    const r = 0.45 + 0.75 * Math.sqrt(rnd()), a = rnd() * 2 * Math.PI;
    s[2 * i] = r * Math.cos(a); s[2 * i + 1] = r * Math.sin(a);
    const v = 0.15 + 0.55 * rnd(), b = rnd() * 2 * Math.PI;
    s[6 + 2 * i] = v * Math.cos(b); s[7 + 2 * i] = v * Math.sin(b);
  }
  for (let k = 0; k < 2; k++) {
    let cp = 0, cv = 0;
    for (let i = 0; i < 3; i++) { cp += s[2 * i + k]; cv += s[6 + 2 * i + k]; }
    for (let i = 0; i < 3; i++) { s[2 * i + k] -= cp / 3; s[6 + 2 * i + k] -= cv / 3; }
  }
  return s;
}
// planets: [{r, phase, dir}] -> circular start around the centre of mass (enclosed mass 3)
function simulate(seed, T, n, planets, eta = 0.003) {
  const K = planets.length, NB = 3 + K, D = NB * 4, V = NB * 2;
  const s3 = initialStars(seed), s = new Float64Array(D);
  for (let i = 0; i < 6; i++) { s[i] = s3[i]; s[V + i] = s3[6 + i]; }
  planets.forEach((p, k) => {
    const c = Math.cos(p.phase), sn = Math.sin(p.phase), v = p.dir * Math.sqrt(3 / p.r) * (p.vf || 1);
    s[6 + 2 * k] = p.r * c; s[7 + 2 * k] = p.r * sn; s[V + 6 + 2 * k] = -v * sn; s[V + 7 + 2 * k] = v * c;
  });
  const k1 = new Float64Array(D), k2 = new Float64Array(D), k3 = new Float64Array(D), k4 = new Float64Array(D), tmp = new Float64Array(D);
  function deriv(st, out) {
    for (let i = 0; i < V; i++) { out[i] = st[V + i]; out[V + i] = 0; }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < NB; j++) {
      const dx = st[2 * j] - st[2 * i], dy = st[2 * j + 1] - st[2 * i + 1];
      const r2 = dx * dx + dy * dy, inv = 1 / (r2 * Math.sqrt(r2));
      out[V + 2 * j] -= dx * inv; out[V + 2 * j + 1] -= dy * inv;       // star i pulls body j
      if (j < 3) { out[V + 2 * i] += dx * inv; out[V + 2 * i + 1] += dy * inv; }
    }
  }
  const pts = new Float32Array((n + 1) * V), dtOut = T / n, cap = Math.pow(0.2, 1.5);
  const dmin = new Float64Array(K).fill(Infinity), rmin = new Float64Array(K).fill(Infinity), rmax = new Float64Array(K);
  for (let f = 0; f <= n; f++) {
    for (let i = 0; i < V; i++) pts[f * V + i] = s[i];
    for (let k = 0; k < K; k++) {
      const x = s[6 + 2 * k], y = s[7 + 2 * k], r = Math.hypot(x, y);
      if (r < rmin[k]) rmin[k] = r; if (r > rmax[k]) rmax[k] = r;
      for (let i = 0; i < 3; i++) { const d = Math.hypot(x - s[2 * i], y - s[2 * i + 1]); if (d < dmin[k]) dmin[k] = d; }
    }
    if (f === n) break;
    let rem = dtOut;
    while (rem > 1e-14) {
      let d = Infinity;
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) d = Math.min(d, Math.hypot(s[2 * j] - s[2 * i], s[2 * j + 1] - s[2 * i + 1]));
      const h = Math.min(rem, eta * Math.min(Math.pow(d, 1.5), cap));
      deriv(s, k1);
      for (let i = 0; i < D; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
      deriv(tmp, k2);
      for (let i = 0; i < D; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
      deriv(tmp, k3);
      for (let i = 0; i < D; i++) tmp[i] = s[i] + h * k3[i];
      deriv(tmp, k4);
      for (let i = 0; i < D; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      rem -= h;
    }
  }
  return { pts, V, K, dmin, rmin, rmax };
}
module.exports = { simulate };

if (require.main === module) {
  const [seed, T, n] = process.argv.slice(2).map(Number), cands = [];
  for (const r of [1.2, 1.35, 1.5, 1.65, 1.8, 2.0, 2.2, 2.4]) for (const dir of [1, -1]) for (let k = 0; k < 36; k++) cands.push({ r, dir, phase: k * Math.PI / 18 });
  const t0 = Date.now(), res = simulate(seed, T, n, cands);
  console.error('sim ms', Date.now() - t0);
  const out = cands.map((c, k) => ({ ...c, phase: +c.phase.toFixed(4), dmin: +res.dmin[k].toFixed(3), rmin: +res.rmin[k].toFixed(2), rmax: +res.rmax[k].toFixed(2) }));
  for (const r of [1.2, 1.35, 1.5, 1.65, 1.8, 2.0, 2.2, 2.4]) for (const dir of [1, -1]) {
    const g = out.filter(o => o.r === r && o.dir === dir), ok = g.filter(o => o.dmin > 0.25 && o.rmax < 3.0 && o.rmin > 0.9);
    console.log(`r=${r} dir=${dir}: ${ok.length}/36 ok;`, ok.map(o => `${Math.round(o.phase * 180 / Math.PI)}°[${o.rmin}-${o.rmax},d${o.dmin}]`).join(' '));
  }
}
