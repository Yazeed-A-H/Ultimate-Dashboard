// Backend sync: the backend doc is the source of truth, `rev` orders versions, and a
// stale write answers {conflict: true, rev, doc} with the current copy. Pure: `put` is injected.

// Save; on conflict re-apply `change` (serverDoc => doc) on the server copy once.
// Returns {ok, rev, doc, merged?} or {ok: false, conflict: true, rev, doc}. `put` rejections propagate.
export async function saveWithRetry(put, baseRev, doc, change) {
  let r = await put({ base_rev: baseRev, doc })
  if (!r.conflict) return { ok: true, rev: r.rev, doc }
  const merged = change ? change(r.doc) : null
  if (!merged) return { ok: false, conflict: true, rev: r.rev, doc: r.doc }
  const server = r
  r = await put({ base_rev: server.rev, doc: merged })
  if (!r.conflict) return { ok: true, rev: r.rev, doc: merged, merged: true }
  return { ok: false, conflict: true, rev: r.rev, doc: r.doc }
}
