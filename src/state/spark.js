// Pure helpers for the Machine sparklines. A buffer is an array of [at, value] pairs, oldest first.
export const pushSample = (buf, at, v, max = 60) =>
  !Number.isFinite(at) || !Number.isFinite(v) || (buf.length && at <= buf[buf.length - 1][0]) ? buf : [...buf, [at, v]].slice(-max)

// Fixed 0-100 scale so a flat 5% line stays low. Values are numbers; fewer than 2 gives ''.
export const sparkPoints = (values, w, h) => values.length < 2 ? '' : values.map((v, i) => `${+(i / (values.length - 1) * w).toFixed(1)},${+(h - Math.max(0, Math.min(100, v)) / 100 * h).toFixed(1)}`).join(' ')
