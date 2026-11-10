// Spend card logic with no DOM: how a cost is labelled, and number formats.

// 'included' (all sessions in the plan), 'unknown' (none priced), else 'est' (money shown, `unpriced` sessions missing from it).
export function costLabel({ sessions, included, unknown }) {
  if (sessions > 0 && included === sessions) return { kind: 'included', unpriced: 0 }
  if (sessions > 0 && unknown === sessions) return { kind: 'unknown', unpriced: 0 }
  return { kind: 'est', unpriced: included + unknown }
}

const nfs = {} // one formatter per locale and kind
const nf = (locale, kind, opts) => (nfs[locale + kind] ||= new Intl.NumberFormat(locale, opts))
export const compact = (locale, n) => nf(locale, 'c', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)
export const money = (locale, v) => nf(locale, '$', { style: 'currency', currency: 'USD' }).format(v || 0)
