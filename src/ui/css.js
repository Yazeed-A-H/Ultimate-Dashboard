// One stylesheet, injected at register and removed on dispose. Colours come only from
// the --ht-* layer below, which reads Hermes' vars with fallbacks ending in a documented var or
// currentColor. Logical properties only. Layout breakpoints are container queries on
// the page itself, so the Hermes sidebar width never matters.
export const CSS = `
.ht, .ht-dlg, .ht-menu {
  --ht-text: var(--ui-text-primary, currentColor);
  --ht-text-2: var(--ui-text-secondary, currentColor);
  --ht-text-3: var(--ui-text-tertiary, var(--ht-text-2));
  --ht-card: var(--ui-bg-elevated, var(--ui-bg-card, color-mix(in srgb, currentColor 6%, transparent)));
  --ht-fill: var(--ui-bg-tertiary, color-mix(in srgb, currentColor 5%, transparent));
  --ht-fill-2: var(--ui-bg-quaternary, color-mix(in srgb, currentColor 7%, transparent));
  --ht-hover: var(--ui-row-hover-background, var(--chrome-action-hover, color-mix(in srgb, currentColor 5%, transparent)));
  --ht-line: var(--ui-stroke-secondary, color-mix(in srgb, currentColor 14%, transparent));
  --ht-line-2: var(--ui-stroke-tertiary, color-mix(in srgb, currentColor 10%, transparent));
  --ht-line-3: var(--ui-stroke-quaternary, color-mix(in srgb, currentColor 7%, transparent));
  --ht-border: var(--dt-border, var(--ht-line));
  --ht-accent: var(--ui-accent, currentColor);
  --ht-ring: var(--ui-accent, currentColor);
  --ht-ok: var(--ui-success, var(--ui-green, var(--ht-text-2)));
  --ht-warn: var(--ui-yellow, var(--ui-orange, var(--ht-text-2)));
  --ht-bad: var(--dt-destructive, var(--ui-red, var(--ht-text-2)));
  --ht-radius: var(--radius-xl, 0.25rem);
  --ht-radius-sm: var(--radius-lg, 0.15rem);
  --ht-mono: var(--font-mono, ui-monospace, monospace);
}
/* dialogs and menus portal to <body>, outside .ht: .ht-dlg / .ht-menu carry the same var layer */
.ht {
  container: ht / inline-size;
  color: var(--ht-text);
  font-size: 0.8125rem;
  line-height: 1.25rem;
  block-size: 100%;
  overflow-y: auto;
}
.ht *, .ht *::before, .ht *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so component classes (.ht-empty …) win */
:where(.ht) :where(h1, h2, h3, p, ul, ol, dl, dd, fieldset) { margin: 0; padding: 0; }
:where(.ht) :where(ul, ol) { list-style: none; }
.ht :focus-visible, .ht-dlg :focus-visible { outline: 2px solid var(--ht-ring); outline-offset: 2px; }
.ht-in { max-inline-size: 90rem; margin-inline: auto; padding: 1.25rem 1.5rem 3rem; }
.ht-vh { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ht .codicon[class*='codicon-'] { flex: none; line-height: 1; }
[dir='rtl'] .ht-flip { transform: scaleX(-1); }
.ht-mono { font-family: var(--ht-mono); font-size: 0.6875rem; }
.ht-sec { color: var(--ht-text-2); }
.ht-spin { animation: ht-spin 1s linear infinite; }
.ht-rf[aria-busy='true'] { opacity: 0.6; cursor: default; }
@keyframes ht-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ht-spin { animation: none; } .ht * { transition: none !important; } }

/* header */
.ht-hero { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem 1.5rem; margin-block-end: 1rem; }
.ht-hero h1 { font-size: 1.5rem; line-height: 1.25; font-weight: 500; }
.ht-date { font-size: 0.75rem; color: var(--ht-text-2); margin-block-start: 0.25rem; }
.ht-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ht-rng { display: inline-flex; flex-wrap: wrap; max-inline-size: 100%; min-inline-size: 0; padding: 2px; gap: 2px; border-radius: var(--ht-radius); background: var(--ht-fill); box-shadow: inset 0 0 0 1px var(--ht-border); }
.ht-rng button { display: inline-flex; align-items: center; justify-content: center; min-block-size: 1.75rem; padding: 0.25rem 0.75rem; border: 0; border-radius: var(--ht-radius-sm); font: inherit; font-size: 0.75rem; font-weight: 500; color: var(--ht-text-2); background: transparent; cursor: pointer; }
.ht-rng button:hover { color: var(--ht-text); }
.ht-rng button[aria-pressed='true'] { background: var(--ht-card); color: var(--ht-text); box-shadow: inset 0 0 0 1px var(--ht-border); }

/* views */
.ht-vbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.5rem; margin-block-end: 1rem; border-block-end: 1px solid var(--ht-line-2); }
.ht-vg { display: flex; align-items: center; gap: 0.25rem; min-inline-size: 0; }
.ht-vlist { display: flex; gap: 0.25rem; min-inline-size: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.ht-vtab { flex: none; min-block-size: 2.25rem; padding: 0.5rem 0.75rem; margin-block-end: -1px; font: inherit; font-weight: 500; color: var(--ht-text-2); background: transparent; border: 0; border-block-end: 2px solid transparent; cursor: pointer; }
.ht-vtab:hover { color: var(--ht-text); }
.ht-vtab[aria-selected='true'] { color: var(--ht-text); border-block-end-color: var(--ht-accent); }
.ht-vt { display: flex; flex: none; align-items: center; }
.ht-vt .ht-vtab { padding-inline-end: 0.25rem; }
.ht-vt-m { opacity: 0.6; margin-block-end: 1px; } .ht-vt:hover .ht-vt-m, .ht-vt[data-active] .ht-vt-m, .ht-vt-m:focus-visible, .ht-vt-m[aria-expanded='true'] { opacity: 1; }
.ht-vbar > .ht-acts { padding-block-end: 0.5rem; margin-inline-start: auto; }

/* quick launch */
.ht-ql { margin-block-end: 1rem; }
/* beats .ht-textarea (defined later): short box, UI font */
.ht-ql .ht-ql-in { inline-size: 100%; min-block-size: 0; margin-block-end: 0.5rem; resize: vertical; font-family: inherit; }
.ht-ql-cap { display: flex; align-items: center; justify-content: flex-start; gap: 0.75rem; margin-block-end: 0.5rem; }
.ht-ql-t { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; font-weight: 500; color: var(--ht-text-2); }
.ht-ql-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ht-ql-list[data-mode='row'] { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 1rem; }
.ht-ql-b { display: flex; align-items: center; gap: 0.75rem; min-inline-size: 0; padding: 0.625rem 1rem; font: inherit; text-align: start; color: var(--ht-text); cursor: pointer; background: var(--ht-card); border: 1px solid var(--ht-border); border-radius: var(--ht-radius); transition: background-color 100ms; }
.ht-ql-b:hover { background: var(--ht-hover); }
.ht-ql-ic { display: grid; place-items: center; flex: none; inline-size: 1.875rem; block-size: 1.875rem; border-radius: 4px; background: color-mix(in srgb, var(--ht-accent) 12%, transparent); color: var(--ht-accent); font-size: 1rem; }
.ht-ql-x { display: grid; min-inline-size: 0; }
.ht-ql-l { font-weight: 500; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-ql-s { font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); overflow-wrap: anywhere; }
.ht-ql-list:not([data-mode='row']) .ht-ql-b { gap: 0.5rem; padding: 0.375rem 0.75rem; }
.ht-ql-list:not([data-mode='row']) .ht-ql-ic { inline-size: auto; block-size: auto; background: none; font-size: 0.875rem; }
.ht-ql-list:not([data-mode='row']) .ht-ql-s { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* grid + cards: 12 columns; s=3, m=4, l=6, xl=12 */
.ht-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-flow: dense; gap: 1rem; }
.ht-card { --py: 0.75rem; position: relative; display: flex; flex-direction: column; min-inline-size: 0; background: var(--ht-card); border: 1px solid var(--ht-border); border-radius: var(--ht-radius); overflow: hidden; }
.ht-card[data-size='s'] { grid-column: span 3; } .ht-card[data-size='m'] { grid-column: span 4; } .ht-card[data-size='l'] { grid-column: span 6; } .ht-card[data-size='xl'] { grid-column: 1 / -1; }
.ht-card[data-density='compact'] { --py: 0.375rem; }
.ht-card-h { display: flex; align-items: center; gap: 0.5rem; min-block-size: 3rem; padding: 0.5rem 1rem; border-block-end: 1px solid var(--ht-line-2); }
.ht-card-h > .ht-hi { color: var(--ht-text-2); font-size: 0.875rem; }
.ht-card-t { min-inline-size: 0; font-size: 0.8125rem; font-weight: 500; line-height: 1.25; overflow-wrap: anywhere; }
.ht-card-r { display: flex; align-items: center; gap: 0.5rem; margin-inline-start: auto; min-inline-size: 0; font-size: 0.75rem; color: var(--ht-text-2); }
.ht-card[data-size='s'] .ht-card-h { flex-wrap: wrap; } /* narrow card: title and level chip wrap instead of clipping */
.ht-card-b { flex: 1; min-inline-size: 0; }
.ht-card-f { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; padding: 0.5rem 1rem 0.625rem; font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); border-block-start: 1px solid var(--ht-line-3); }
.ht-card-f [data-stale='true'] { color: var(--ht-text); }
.ht-card-f [data-stale='true']::before { content: ''; display: inline-block; inline-size: 0.5rem; block-size: 0.5rem; margin-inline-end: 0.375rem; border-radius: 9999px; background: var(--ht-warn); }
.ht-count { min-inline-size: 1.25rem; padding: 0.125rem 0.375rem; border-radius: 3px; text-align: center; font-size: 0.6875rem; line-height: 1rem; font-weight: 500; font-variant-numeric: tabular-nums; background: var(--ht-fill-2); color: var(--ht-text); }
.ht-warnb { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.375rem; border-radius: 3px; font-size: 0.6875rem; line-height: 1rem; font-weight: 500; background: color-mix(in srgb, var(--ht-warn) 16%, transparent); color: var(--ht-text); align-self: center; }
.ht-warnb > :first-child { color: var(--ht-warn); }

/* states */
.ht-state { display: grid; justify-items: center; gap: 0.375rem; padding: 1.5rem 1rem; text-align: center; }
.ht-state > .ht-hi { font-size: 1.25rem; color: var(--ht-text-2); }
.ht-state-t { font-weight: 500; }
.ht-state-d { max-inline-size: 26rem; font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); text-wrap: balance; }
.ht-state[data-kind='error'] > .ht-hi { color: var(--ht-bad); }
.ht-state[data-kind='unavailable'] > .ht-hi { color: var(--ht-warn); }
.ht-empty { padding: 0.75rem 1rem; font-size: 0.75rem; color: var(--ht-text-2); }
.ht-wait { padding-inline: 1rem; }
.ht-skel { display: grid; gap: 0.5rem; padding: 0.75rem 1rem; }
.ht-skel > span { block-size: 0.75rem; border-radius: 3px; background: var(--ht-fill); }
.ht-skel > span:nth-child(2) { inline-size: 70%; } .ht-skel > span:nth-child(3) { inline-size: 45%; }

/* rows */
.ht-rows > li + li { border-block-start: 1px solid var(--ht-line-3); }
.ht-rows[data-cols='2'] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ht-rows[data-cols='2'] > li { border-block-start: 1px solid var(--ht-line-3); }
.ht-rows[data-cols='2'] > li:nth-child(-n+2) { border-block-start: 0; }
.ht-rows[data-cols='2'] > li:nth-child(odd) { border-inline-end: 1px solid var(--ht-line-3); }
.ht-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding: var(--py) 1rem; }
.ht-row-link { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; inline-size: 100%; padding: var(--py) 1rem; font: inherit; text-align: start; color: inherit; background: transparent; border: 0; cursor: pointer; }
.ht-row-link:hover { background: var(--ht-hover); }
.ht-row-link:focus-visible { outline-offset: -2px; }
.ht-rw { min-inline-size: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 't time' 'm m'; gap: 0.125rem 0.75rem; align-items: baseline; }
.ht-rw-t { grid-area: t; font-weight: 500; overflow-wrap: anywhere; }
.ht-clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--lines, 1); overflow: hidden; overflow-wrap: anywhere; text-overflow: ellipsis; }
.ht-rw-time { grid-area: time; font-size: 0.75rem; color: var(--ht-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ht-rw-m { grid-area: m; display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.5rem; font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); overflow-wrap: anywhere; }
.ht-wk > .ht-rw-m { grid-area: auto / 1 / auto / -1; } /* grid-area 'm' (above) names no area in .ht-wk: every line would share one cell */
.ht-tag { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.0625rem 0.375rem; margin-inline-end: 0.375rem; border-radius: 3px; font-size: 0.6875rem; line-height: 1rem; font-weight: 500; vertical-align: 1px; box-shadow: inset 0 0 0 1px var(--ht-line); color: var(--ht-text-2); }
.ht-tag[data-tone='warn'] { box-shadow: none; background: color-mix(in srgb, var(--ht-warn) 16%, transparent); color: var(--ht-text); }
.ht-tag[data-tone='bad'] { box-shadow: none; background: color-mix(in srgb, var(--ht-bad) 16%, transparent); color: var(--ht-text); }
.ht-rw-st { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; }
.ht-rw-st .ht-tag { margin-inline-end: 0; vertical-align: baseline; }
.ht-more-n { display: none; }
.ht-jr-md { overflow: hidden; max-block-size: 12rem; padding: 0.75rem 1rem 0.625rem; font-size: 0.8125rem; line-height: 1.5; color: var(--ht-text); overflow-wrap: anywhere; }
.ht-jr-md[data-size='l'] { max-block-size: 20rem; }
.ht-jr-md[data-size='xl'] { max-block-size: 28rem; }
.ht-lg-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 1rem; }
.ht-lg { max-block-size: 12rem; overflow: auto; padding: 0.25rem 1rem 0.5rem; font-family: var(--ht-mono); font-size: 0.75rem; line-height: 1.45; text-align: start; }
.ht-lg[data-size='l'] { max-block-size: 22rem; }
.ht-lg[data-size='xl'] { max-block-size: 32rem; }
.ht-lg-r { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.ht-lg[data-size='m'] .ht-lg-r { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ht-lg-r[data-lv='muted'] { color: var(--ht-text-3); }
.ht-lg-r[data-lv='warn'] .ht-lg-l { color: var(--ht-warn); }
.ht-lg-r[data-lv='bad'] .ht-lg-l { color: var(--ht-bad); }
.ht-lg-l { font-weight: 600; }
.ht-jr-md[data-open] { max-block-size: none; }
.ht-jr-md table { display: block; overflow-x: auto; max-inline-size: 100%; }
.ht-jr-md pre { overflow-x: auto; }
.ht-jr-more { margin: 0.5rem 1rem; }
.ht-jr > .ht-state-d { padding: 0 1rem; }
.ht-tag[data-tone='accent'] { box-shadow: none; background: color-mix(in srgb, var(--ht-accent) 12%, transparent); color: var(--ht-text); }
.ht-ap-act { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.375rem; }
.ht-ap-cmd { font-family: var(--ht-mono); font-size: 0.75rem; overflow-wrap: anywhere; }
.ht-st { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--ht-text); }
.ht-st > .ht-dot { inline-size: 0.5rem; block-size: 0.5rem; border-radius: 9999px; flex: none; background: var(--ht-text-3); }
.ht-st[data-tone='ok'] > .ht-dot { background: var(--ht-ok); }
.ht-st[data-tone='warn'] > .ht-dot { background: var(--ht-warn); }
.ht-st[data-tone='bad'] > .ht-dot { background: var(--ht-bad); }
.ht-st[data-tone='accent'] > .ht-dot { background: var(--ht-accent); }
.ht-more { padding: 0.5rem 1rem; font-size: 0.75rem; color: var(--ht-text-2); border-block-start: 1px solid var(--ht-line-3); }
.ht-link { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0; font: inherit; font-size: 0.75rem; font-weight: 500; color: var(--ht-text-2); background: none; border: 0; cursor: pointer; }
.ht-link:hover { color: var(--ht-text); text-decoration: underline; }

/* meters, stats, kv, tiles */
.ht-bar { position: relative; block-size: 0.375rem; border-radius: 9999px; overflow: hidden; background: var(--ht-fill); box-shadow: inset 0 0 0 1px var(--ht-line); }
.ht-spark { display: block; inline-size: 100%; block-size: 1.5rem; fill: none; stroke: var(--ht-accent); stroke-width: 1.5; stroke-linejoin: round; }
.ht-spark polyline { vector-effect: non-scaling-stroke; }
.ht-spark[data-warn='true'] { stroke: var(--ht-warn); }
.ht-bar > span { display: block; block-size: 100%; border-radius: 9999px; background: var(--ht-accent); }
.ht-bar[data-warn='true'] > span { background: var(--ht-warn); }
.ht-us { display: grid; gap: 0.5rem; padding: var(--py) 1rem; }
.ht-us-h { font-weight: 500; }
.ht-us-w { display: grid; gap: 0.25rem; }
.ht-us-w > .ht-rw-m { grid-area: auto; } /* the meta grid-area would add an implicit column here and squeeze the bar */
.ht-us-l { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.125rem 0.75rem; font-size: 0.75rem; }
.ht-us-l > span:first-child { display: inline-flex; align-items: center; gap: 0.5rem; }
.ht-us-v { color: var(--ht-text-2); font-variant-numeric: tabular-nums; }
.ht-kv-r { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 0.75rem; align-items: baseline; padding: calc(var(--py) * 0.75) 1rem; }
.ht-kv-r + .ht-kv-r { border-block-start: 1px solid var(--ht-line-3); }
.ht-kv-r dt { font-size: 0.75rem; color: var(--ht-text-2); }
.ht-kv-r dd { overflow-wrap: anywhere; }
.ht-chips { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; }
.ht-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ht-tile { display: grid; gap: 0.25rem; padding: var(--py) 1rem; align-content: start; }
.ht-tile:nth-child(even) { border-inline-start: 1px solid var(--ht-line-3); }
.ht-tile:nth-child(n+3) { border-block-start: 1px solid var(--ht-line-3); }
.ht-tile-l { font-size: 0.75rem; color: var(--ht-text-2); }
.ht-tile-s { font-size: 0.75rem; color: var(--ht-text-2); font-variant-numeric: tabular-nums; }
.ht-tile-v { font-size: 1.25rem; line-height: 1.5rem; font-weight: 500; font-variant-numeric: tabular-nums; }
.ht-sk-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; padding: 0.5rem 1rem; font-weight: 500; }
.ht-sub-t { padding: 0.875rem 1rem 0.375rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ht-text-2); }
.ht-sep-d { color: var(--ht-text-3); }
.ht-f-i { display: grid; place-items: center; flex: none; inline-size: 1.75rem; block-size: 1.75rem; border-radius: 4px; background: var(--ht-fill-2); color: var(--ht-text-2); }
.ht-f-r { display: flex; align-items: center; gap: 0.75rem; }

/* tables */
.ht-tw { overflow-x: auto; }
.ht-wk { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); border-block-start: 1px solid var(--ht-line-3); }
.ht-wk > :not(section) { grid-column: 1 / -1; }
.ht-wk > section { padding-block-end: 0.5rem; }
.ht-wk-d { padding: 0.5rem 1rem 0.25rem; font-weight: 500; color: var(--ht-text); }
.ht-wk-r { display: flex; gap: 0.75rem; padding: 0.25rem 1rem; font-size: 0.8125rem; }
.ht-wk-r > :not(time) { min-inline-size: 0; overflow-wrap: anywhere; }
.ht-wk-r time { flex: none; min-inline-size: 4.5rem; color: var(--ht-text-2); font-variant-numeric: tabular-nums; }
.ht-dt { inline-size: 100%; border-collapse: collapse; }
.ht-dt th, .ht-dt td { padding: var(--py) 1rem; text-align: start; vertical-align: top; }
.ht-dt thead th { font-size: 0.75rem; font-weight: 500; color: var(--ht-text-2); border-block-end: 1px solid var(--ht-line-2); white-space: nowrap; }
.ht-dt tbody tr + tr > * { border-block-start: 1px solid var(--ht-line-3); }
.ht-dt tbody th { font-weight: 500; }
.ht-dt td { color: var(--ht-text-2); font-variant-numeric: tabular-nums; }
.ht-dt .ht-lb { display: none; }
.ht-dt .ht-nw { white-space: nowrap; }
.ht-dt-n { --lines: 2; max-inline-size: 16rem; } /* a long error would take the table's width; the full text is in the tooltip and on the Scheduled jobs page */

/* edit mode */
.ht-editbar { position: sticky; inset-block-start: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-block-end: 1rem; padding: 0.5rem 0.75rem; background: var(--ht-card); border: 1px solid var(--ht-border); border-radius: var(--ht-radius); box-shadow: var(--shadow-md, none); }
.ht-editing { scroll-padding-block-start: 5rem; } /* keeps a scrolled-to card header clear of the sticky bar */
.ht-editing .ht-card { scroll-margin-block-start: 5rem; }
.ht-editbar-t { font-weight: 500; }
.ht-editbar-hint { flex: 1 1 14rem; min-inline-size: 0; font-size: 0.75rem; color: var(--ht-text-2); }
.ht-sep { inline-size: 1px; block-size: 1.25rem; background: var(--ht-line); }
.ht-editing .ht-card { outline: 1px dashed var(--ht-line); outline-offset: 2px; }
.ht-card[data-dragging='true'] { opacity: 0.4; }
.ht-card[data-grabbed='true'] { outline: 2px solid var(--ht-accent); outline-offset: 2px; }
.ht-grip { display: inline-grid; place-items: center; inline-size: 1.75rem; block-size: 1.75rem; margin-inline-start: -0.5rem; padding: 0; border: 0; border-radius: 4px; color: var(--ht-text-3); background: transparent; cursor: grab; touch-action: none; }
/* aria-disabled buttons keep focus, so they are dimmed by hand (Edit layout while editing, Add once added, move at the ends) */
.ht-off[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.ht-grip:hover { color: var(--ht-text); background: var(--ht-hover); }
.ht-grip[aria-pressed='true'] { color: var(--ht-text); background: var(--ht-fill-2); }
.ht-ins { position: fixed; z-index: 50; pointer-events: none; background: var(--ht-accent); border-radius: 2px; }
.ht-ghost { position: fixed; z-index: 51; pointer-events: none; padding: 0.375rem 0.75rem; font-size: 0.75rem; font-weight: 500; background: var(--ht-card); border: 1px solid var(--ht-accent); border-radius: var(--ht-radius); box-shadow: var(--shadow-md, none); }
.ht-gal { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 0.75rem; max-block-size: min(60vh, 34rem); overflow-y: auto; padding: 0.25rem; }
.ht-gal-i { display: grid; gap: 0.375rem; align-content: start; padding: 0.75rem; border: 1px solid var(--ht-border); border-radius: var(--ht-radius); background: var(--ht-card); }
.ht-gal-h { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
.ht-gal-d { font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); }
.ht-gal-a { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; margin-block-start: 0.25rem; }
.ht-form { display: grid; gap: 0.875rem; }
.ht-banner { display: flex; align-items: center; gap: 0.5rem; margin-block-end: 1rem; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--ht-text-2); background: var(--ht-card); border: 1px solid var(--ht-border); border-radius: var(--ht-radius); }
.ht-banner > span { flex: 1; min-inline-size: 0; }
.ht-banner:not([data-kind='hint']) > .ht-hi, .ht-banner:not([data-kind='hint']) > svg { color: var(--ht-warn); }
/* shortcut dialog: the body scrolls, Save stays in view (700px-high windows) */
.ht-dlg-form { max-block-size: calc(100dvh - 2rem); display: flex; flex-direction: column; }
.ht-form-sticky { display: flex; flex-direction: column; min-block-size: 0; flex: 1; gap: 0.5rem; }
.ht-form-body { display: grid; gap: 0.875rem; overflow-y: auto; min-block-size: 0; padding: 0.25rem; }
.ht-form-foot { padding-block-start: 0.5rem; border-block-start: 1px solid var(--ht-line-2); background: inherit; }
.ht-adv > summary { cursor: pointer; font-weight: 500; font-size: 0.75rem; color: var(--ht-text-2); padding-block: 0.25rem; }
.ht-adv[open] > summary { margin-block-end: 0.5rem; }
.ht-fld { display: grid; gap: 0.375rem; min-inline-size: 0; font-size: 0.75rem; color: var(--ht-text-2); }
.ht-fld > .ht-fld-l { font-weight: 500; color: var(--ht-text); }
.ht-checks { display: grid; gap: 0.25rem; }
.ht-check { display: flex; align-items: center; gap: 0.5rem; min-block-size: 1.75rem; color: var(--ht-text); cursor: pointer; }
.ht-prev { padding: 0.5rem 0.75rem; border-radius: var(--ht-radius-sm); background: var(--ht-fill); font-family: var(--ht-mono); font-size: 0.75rem; overflow-wrap: anywhere; }
.ht-model-btn { inline-size: 100%; block-size: auto; min-block-size: 2rem; justify-content: space-between; gap: 0.5rem; padding-block: 0.375rem; font-weight: 400; text-align: start; white-space: normal; overflow-wrap: anywhere; }
.ht-list-pick { display: grid; min-inline-size: 0; max-block-size: 16rem; overflow-y: auto; overflow-x: hidden; border: 1px solid var(--ht-line); border-radius: var(--ht-radius-sm); }
.ht-list-pick > button { display: grid; gap: 0.125rem; padding: 0.375rem 0.625rem; font: inherit; text-align: start; color: var(--ht-text); background: transparent; border: 0; cursor: pointer; }
.ht-list-pick > button + button { border-block-start: 1px solid var(--ht-line-3); }
.ht-list-pick > button:hover, .ht-list-pick > button[aria-selected='true'] { background: var(--ht-hover); }
.ht-list-pick > button { border-inline-start: 2px solid transparent; }
.ht-list-pick > button[aria-selected='true'] { border-inline-start-color: var(--ht-accent); }
.ht-dlg .ht-list-pick { max-block-size: 15rem; }
.ht-list-pick > button { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.ht-list-pick > button > :is(bdi, span:first-child) { grid-column: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-list-pick > button > small { grid-column: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-list-pick .ht-pick-ck { grid-column: 2; grid-row: 1 / span 2; color: var(--ht-accent); }
.ht-mn-t { color: var(--ht-text-2); }
.ht-ql-m { display: inline-block; margin-inline-start: 0.5rem; padding: 0 0.375rem; border-radius: 3px; font-size: 0.6875rem; line-height: 1rem; box-shadow: inset 0 0 0 1px var(--ht-line); }
.ht-list-pick small { font-size: 0.6875rem; color: var(--ht-text-2); }
.ht-textarea { inline-size: 100%; min-block-size: 8rem; font-family: var(--ht-mono); font-size: 0.75rem; }

/* settings pages */
.ht-set { color: var(--ht-text); }
/* one control width on Settings pages; select value text follows the reading direction */
.ht-set { --ht-ctl: 14rem; }
.ht-ctl { inline-size: var(--ht-ctl); max-inline-size: 100%; } /* a fixed size: min(..., 100%) resolved against the shrink-to-fit row and gave 93-157px */
button.ht-ctl, .ht-ctl .ht-sv { text-align: start; }
/* Hermes' DialogHeader is sm:text-left; our dialogs follow the direction */
.ht-dlg .ht-dh { text-align: start; }
/* Hermes keeps the close button on the physical right edge, so reserve its room at the end (LTR) or the start (RTL) of the header */
.ht-dlg .ht-dh { padding-inline-end: 1.75rem; }
[dir='rtl'] .ht-dlg .ht-dh { padding-inline: 1.75rem 0; }
.ht-set-sec { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; margin-block: 1rem; }
.ht-set-sec > h3 { font-size: 0.8125rem; font-weight: 500; }
.ht-set-d { font-size: 0.75rem; line-height: 1rem; color: var(--ht-text-2); }
.ht-sc { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-inline-size: 0; padding: 0.5rem 0.75rem; border: 1px solid var(--ht-line-2); border-radius: var(--ht-radius-sm); background: var(--ht-card); }
.ht-sc + .ht-sc { margin-block-start: 0.375rem; }
.ht-sc-x { flex: 1 1 8rem; min-inline-size: 0; display: grid; }
.ht-sc-l { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-sc-m { font-size: 0.75rem; color: var(--ht-text-2); overflow-wrap: anywhere; }
/* The host Switch thumb moves with a fixed translate-x, so in RTL a checked switch pushes it out of the track. */
[dir=rtl] .ht-set [role=switch][data-state=checked] > span { translate: -1rem 0; }
.ht-keyf { display: grid; gap: 0.25rem; }
.ht-keyf-r { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ht-keyf-e { font-size: 0.75rem; color: var(--ht-bad); }
.ht-kbd { min-inline-size: 4.5rem; padding: 0.25rem 0.625rem; text-align: center; border: 1px solid var(--ht-line-3); border-radius: var(--ht-radius-sm); background: var(--ht-fill); font-family: var(--ht-mono); font-size: 0.75rem; color: var(--ht-text); }
.ht-kbd[data-rec] { border-color: var(--ht-accent); }
.ht-prompt { min-block-size: 6rem; font-family: inherit; font-size: 0.8125rem; white-space: pre-wrap; resize: vertical; }
.ht-job { display: flex; align-items: center; gap: 0.625rem; min-inline-size: 0; padding: 0.5rem 0.75rem; cursor: pointer; }
.ht-job + .ht-job { border-block-start: 1px solid var(--ht-line-3); }
.ht-job-x { display: grid; min-inline-size: 0; overflow-wrap: anywhere; }

/* responsive: container widths (the page, not the window) */
@container ht (max-width: 56rem) {
  .ht-editbar-hint { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } /* visually hidden, still read; the bar's title shows it */
}
@container ht (max-width: 62rem) {
  .ht-card[data-size='s'] { grid-column: span 6; }
  .ht-card[data-size='m'], .ht-card[data-size='l'], .ht-card[data-size='xl'] { grid-column: 1 / -1; }
  .ht-ql-list[data-mode='row'] { grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
}
@container ht (max-width: 44rem) {
  .ht-in { padding: 0.75rem 1rem 2.5rem; }
  .ht-acts { inline-size: 100%; }
  .ht-rng { flex: 1 0 100%; } .ht-rng button { flex: 1; min-block-size: 2.75rem; }
  .ht-ql-list[data-mode='row'] { grid-template-columns: minmax(0, 1fr); }
  .ht-rows[data-cols='2'] { grid-template-columns: minmax(0, 1fr); }
  .ht-rows[data-cols='2'] > li:nth-child(2) { border-block-start: 1px solid var(--ht-line-3); }
  .ht-rows[data-cols='2'] > li:nth-child(odd) { border-inline-end: 0; }
  .ht-row { grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
  .ht-ap-act { justify-content: flex-start; }
  .ht-rw { grid-template-areas: 't t' 'm time'; align-items: center; }
  .ht-vtab, .ht-ql-b, .ht-row-link, .ht-grip { min-block-size: 2.75rem; }
  .ht-grip { min-inline-size: 2.75rem; }
  .ht-dt thead { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .ht-dt, .ht-dt tbody, .ht-dt tr, .ht-dt th, .ht-dt td { display: block; inline-size: 100%; }
  .ht-dt tbody tr { padding: 0.5rem 1rem; }
  .ht-dt tbody tr + tr { border-block-start: 1px solid var(--ht-line-3); }
  .ht-dt tbody tr + tr > * { border-block-start: 0; }
  .ht-dt th, .ht-dt td { padding: 0.125rem 0; }
  .ht-dt td { display: flex; gap: 0.75rem; }
  .ht-dt tbody tr:nth-child(n+6), .ht-dt td[data-empty] { display: none; }
  .ht-more-n { display: block; }
  .ht-tw > .ht-more:not(.ht-more-n) { display: none; }
  .ht-dt td > .ht-lb { display: block; flex: none; inline-size: 5rem; font-size: 0.75rem; }
}
@media (pointer: coarse) {
  .ht-grip, .ht-vtab, .ht-ql-b, .ht-rng button, .ht-check, .ht-link, .ht-list-pick > button, .ht-job, .ht-sc, .ht-row-link { min-block-size: 2.75rem; }
  .ht-grip { min-inline-size: 2.75rem; }
  .ht-link { padding-block: 0.5rem; }
  /* every other button, including the 24px host icon buttons (checkbox and switch rows are sized by their label) */
  :is(.ht, .ht-dlg) button:not([role='checkbox'], [role='switch'], [role='option']) { min-block-size: 2.75rem; min-inline-size: 2.75rem; }
  :is(.ht, .ht-dlg) input:not([type='checkbox']) { min-block-size: 2.75rem; }
}
/* Arabic needs about 1px more than Latin at small sizes */
[dir='rtl'] :is(.ht-count, .ht-warnb, .ht-tag, .ht-list-pick small) { font-size: 0.75rem; }
[dir='rtl'] :is(.ht-date, .ht-rng button, .ht-ql-t, .ht-ql-s, .ht-card-r, .ht-card-f, .ht-state-d, .ht-empty, .ht-rw-time, .ht-rw-m, .ht-more, .ht-link, .ht-us-l, .ht-kv-r dt, .ht-tile-l, .ht-sub-t, .ht-dt thead th, .ht-editbar-hint, .ht-gal-d, .ht-banner, .ht-adv > summary, .ht-fld, .ht-set-d, .ht-sc-m, .ht-keyf-e, .ht-kbd) { font-size: 0.8125rem; }
/* uppercase and tracking do not exist in Arabic (tracking also breaks the joins) */
[dir='rtl'] .ht-sub-t { letter-spacing: 0; text-transform: none; }
`
