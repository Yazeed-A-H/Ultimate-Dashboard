# Add a card

How to add one card to Ultimate Dashboard. Written for a developer or a coding agent. Search for the quoted names if they moved.

Worked examples: **Services** (data from the SDK, no backend) and **Machine** (data from the plugin backend).

## 1. Register it — `src/state/cards.js`

Add a row to `DEFS`:

```js
// [id, codicon, sizes, defaultSize, extra options]
['services', 'server-process', ['m', 'l'], 'm', []],
['machine', 'vm', ['m', 'l'], 'm', [fields('cpu', 'memory', 'disk', 'uptime'), PCT('warnCpu'), PCT('warnMem'), PCT('warnDisk')]],
```

- `id` keys everything else: the body in `BODIES`, the i18n keys `card.<id>` and `desc.<id>`.
- `codicon` is a VS Code codicon name rendered by the SDK `Codicon`.
- `sizes` are the widths the user may pick (`s`, `m`, `l`, `xl`); `defaultSize` is used on add and when a saved size is invalid.
- Every card also gets the common options `density` and `title`.

Option types you can reuse, already validated in `sanitizeOptions` and rendered in `CardOptions` (`src/ui/page.jsx`):

| Helper | Stores | Use |
|---|---|---|
| `RANGE` | `today` / `7d` / `30d` | time window |
| `PCT('key')` | integer 50–99, default 90 | warning threshold |
| `PROVIDERS` | list of provider ids | which providers to show |
| `fields('a', 'b')` | subset of the choices | which rows or tiles to show; read with `show('a')` |

A new option type needs three things: a helper, a validation line in `sanitizeOptions`, and a renderer in `CardOptions`. `bool` and `text` have no generic renderer; copy `pinnedOnly` and `title`.

Unknown card ids in saved layouts are dropped on load. If you rename or remove a card, add an entry to `ALIASES` so old layouts migrate.

## 2. The body — `src/ui/cards.jsx`

Export a function that returns `{ meta?, body, foot? }` and add it to `BODIES` at the end of the file:

```jsx
export function Services() {
  const t = useT(), q = useStatus()
  return { body: <Q q={q}>{s => (/* rows */)}</Q>, foot: <Updated q={q} /> }
}
```

Use the shared parts in `src/ui/parts.jsx` instead of writing your own states:

- `Q` handles loading (skeleton), error (with Retry), "not available" with the reason, and, with the `backend` prop, the case where the plugin backend is not mounted.
- `Updated` shows the last-updated or stale line, `Bar` a meter, `Near` the near-limit badge, `Tone` a coloured chip, `Ltr`/`Auto` bidi isolation for paths and mixed text.
- `useCard()` gives `card`, `size`, `range` and `show(field)`.

Styling goes in `src/ui/css.js` with the `ht-` prefix and Hermes CSS variables only; a static test fails on hex or named colours in `src/ui`.

## 3. Data — `src/ui/data.js`

Add a query hook. Two patterns:

```js
// SDK or RPC (no backend needed)
export function useStatus() { const every = useRefresh(); return useQuery({ queryKey: qk('status'), queryFn: () => host.status(), refetchInterval: every }) }
// Plugin backend route
export function useMachine() { const every = useRefresh(), on = useBackendOn(); return useQuery({ queryKey: qk('machine'), queryFn: () => rest('/machine'), refetchInterval: minMs(every, 10e3), retry: 0, enabled: on }) }
```

- Always build keys with `qk(...)`, so Refresh and plugin disable clear them.
- `useRefresh()` follows the user's refresh setting; "Manually" turns the timer off.
- Only call public SDK exports, `ctx` members, and RPC methods listed in Hermes' `tui_gateway/contracts`. The catalog rejects plugins that read app internals.

## 4. Backend route (only if needed) — `plugin/dashboard/plugin_api.py`

Copy the `/machine` route: return `{"available": True, ...}` on success and `_unavailable(reason)` when a dependency or file is missing, so the card shows the reason instead of an error. Read Hermes data read-only. Add a test in `tests/test_api.py`.

A change here loads only after a gateway restart, run from a terminal. Until then the route returns 404 and the card shows "not available".

New reads outside the plugin's own data, network calls, or commands must be disclosed in `plugin/README.md` (catalog rule 13).

## 5. Text — `src/ui/i18n.js`

Add keys to **both** the `en` and `ar` bundles:

- `card.<id>`: title (gallery and card header)
- `desc.<id>`: one-line gallery description
- `opt.<key>` for each new option, `f.<choice>` for each field choice
- any card-internal strings, under a short prefix like `svc.` or `m.`

The static tests fail if a key is missing in one locale, if code uses a key that does not exist, or if a key is unused. Keys under a prefix in `DYNAMIC` (`tests/static.test.mjs`, e.g. `card.`, `desc.`, `opt.`, `f.`, `svc.`) may be built at run time; others must appear literally in the source.

## 6. Default views (optional) — `src/state/store.js`

You don't need this step for the card to work: the gallery lists every registered card. Add it to `BUILTIN_TEMPLATES` only if it should appear on a fresh install. Widths in a template must sum to 12, and `tests/state.test.mjs` checks the default lists.

## 7. Tests

- `tests/state.test.mjs`: bump the `assert.equal(CARDS.length, …)` count (16 today).
- `tests/static.test.mjs`: add the id to the list that checks `card.<id>` and `desc.<id>` in both locales.
- Add a sanitize test if the card has new options.

## 8. Build and check

```sh
node tools/build.mjs            # writes plugin/desktop/plugin.js; Desktop hot-reloads
node --test tests/
python3 -m unittest discover -s tests -p 'test_*.py'
```

The bundle must stay under 256 KB (the limit in `tests/static.test.mjs`; it is about 228 KB today). Then open the page in Hermes, add the card from the gallery, and check it in light and dark mode, in Arabic (RTL), and with the backend off.

## Cards you can add more than once

Most cards appear once per view. A card type can instead allow many copies, each with its own options. **Job result** does this: one card per scheduled job.

- Mark the type in `src/state/cards.js`: add the id to the `MULTI` set (only `job-result` is in it). Every `CARDS` entry has `multi: boolean`.
- A copy is an **instance**. Its id is `<type>~` plus 6 characters `[a-z0-9]`, for example `job-result~k3x9qa`. The bare type id is never stored in a view; a saved id with a bad suffix, or whose type is not multi, is dropped on load.
- `baseId(id)` returns the part before the first `~`. Use it wherever an id builds an i18n key (`card.`, `desc.`) or picks a body in `BODIES`. `getCard`, `hasOption` and `sanitizeOptions` already resolve through it.
- `store.addCard(type, size, options)` on a multi type always creates a new instance and returns its id (a string), or `false` at the cap of 12 instances of one type per view. `toggleCard` adds for a type id and removes for an instance id.
- Everything else (size, options, move, templates, export and import, sync) takes the instance id.
- In the gallery a multi type always shows an add button ("Add another" once one exists) and never Remove. A copy is removed from the card itself.
- A new option type for a multi card (such as `job`) follows the same three steps as any option type.

The instance's own option (here `job`) is read with `useCard().card.options`. A backend route that takes that option must validate it again (see `/job-output`).

## Checklist

1. `src/state/cards.js`: `DEFS` row (plus helper and validation for a new option type)
2. `src/ui/cards.jsx`: body function and `BODIES` entry
3. `src/ui/data.js`: query hook
4. `plugin/dashboard/plugin_api.py` and `tests/test_api.py`: only for a new route; restart the gateway
5. `src/ui/i18n.js`: `en` and `ar` keys
6. `src/ui/page.jsx`: only for a new option renderer
7. `src/state/store.js`: only for default views
8. `tests/state.test.mjs` card count, `tests/static.test.mjs` id list
9. Build, test, check in Hermes
