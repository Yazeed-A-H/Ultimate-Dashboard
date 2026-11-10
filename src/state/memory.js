// Agent memory card: fill level of MEMORY.md / USER.md against their character limits (pure; the route sends numbers only).
export const memPct = f => (f.limit > 0 ? (f.chars / f.limit) * 100 : 0)
// Highest fill among files Hermes actually injects; a disabled file is not "near" anything.
export const memHigh = files => Math.max(0, ...Object.values(files).filter(f => f.enabled).map(memPct))
