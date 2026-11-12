# Ultimate Dashboard

A customizable dashboard for Hermes Desktop and the Webapp. It follows the Hermes theme, language and direction (English and Arabic, RTL).

Cards: approvals waiting for you, running sessions, scheduled jobs (with a 7-day timeline), plan usage per provider, spend (tokens and estimated cost), services, health, machine stats, logs, agent memory, skills, tool activity, files made in sessions, Worker history, live tasks (what the main agent and each Worker are doing now), the latest result of any scheduled job you pick (Job result, add one card per job), and Quick launch shortcuts. You arrange them in views, and the layout is shared between Desktop and the Webapp.

## Install

The plugin is the `plugin/` subfolder of the repo (`Yazeed-A-H/Ultimate-Dashboard`), not the repo root. Requires Hermes 0.23.0 or later.

**Option A: install from Git.** `hermes plugins install` accepts `owner/repo/subdirectory`:

```
hermes plugins install Yazeed-A-H/Ultimate-Dashboard/plugin
```

Add `--enable` to skip the enable prompt.

**Option B: clone and link** (use this to track a checkout). Clone the repo, then link or copy its `plugin/` folder into the `plugins` folder of your Hermes home. macOS and Linux: `ln -s <clone>/plugin ~/.hermes/plugins/ultimate-dashboard`. Windows: copy the folder to `%LOCALAPPDATA%\hermes\plugins\ultimate-dashboard` (Hermes' default home on Windows; if you set `HERMES_HOME`, use that path).

Then enable it and restart the gateway. Your Hermes agent can run the enable; the restart has to come from a terminal, because Hermes does not restart its own gateway from inside a chat:

```
hermes plugins enable ultimate-dashboard
hermes gateway restart
```

A running gateway picks up a newly enabled plugin on its first request, so here the restart is a safety net; it is required after an update, because the backend module is cached (see Update). If the Machine, Files made, Workers, Spend, Activity, Memory, Skills, Job result and sync cards stay unavailable, restart. Hermes gates the backend per profile: enable the plugin in every profile that should show data (`hermes -p <profile> plugins enable ultimate-dashboard`).

In Hermes Desktop: **Capabilities → Plugins → Ultimate Dashboard** → turn on **Desktop**. If Dashboard is not in the sidebar, this switch is off.

**Check it worked:** in Hermes, open **Settings → Plugins → Ultimate Dashboard**. Under **Backend and sync** it shows **Connected**. The page appears in the sidebar as **Dashboard**, once the Desktop switch above is on.

Remote gateway: install, enable and restart on the gateway machine (the backend runs there).

## Platforms

Linux and Windows are tested by CI (GitHub-hosted runners) before each release; macOS is tested locally:

- **Backend on a running Hermes 0.23.0**: on Ubuntu (`install.sh`) and native Windows (`install.ps1`) the plugin installs, enables and validates, and its routes `/health`, `/machine`, `/files` and `/state` answer correctly (Windows file paths included).
- **Unit tests** (layout logic and backend) pass on Ubuntu (pull requests that change code; docs-only changes skip CI), Windows (each release) and macOS (local).
- **Not covered by CI:** the Desktop app and Webapp UI on Linux and Windows (the page was only exercised on macOS), and installing from Git with `hermes plugins install`.

## Update

`hermes plugins update ultimate-dashboard` (Git install), or `git pull` in your clone (linked install). Then `hermes gateway restart`, since the backend only reloads on restart.

## Disclosure: what the plugin reads, runs, stores and sends

**Network.** The plugin makes no request to any third party and has no telemetry or analytics. Its page talks only to your own Hermes gateway (Hermes RPC and the plugin's own routes). One indirect case: the Usage card runs `hermes usage` through Hermes, and that command, running on the gateway machine, contacts the usage endpoint of each provider you are signed in to (see Shell commands).

**Hermes RPC methods it calls** (through the plugin SDK, so Hermes applies its own auth):

| Method | Used for |
| --- | --- |
| `approval.pending` | List approvals waiting in running sessions |
| `approval.respond` | Answer an approval, only when you click Approve (`once`) or Reject (`deny`), for that one `request_id`. It never sends `always`. |
| `session.active_list` | Running sessions |
| `session.list` | Recent sessions (up to 60) |
| `session.create` | Only when a Quick launch shortcut or the default model names a model: creates the chat with that model |
| `cron.manage` | `list` only (scheduled jobs). It never creates, edits, pauses or runs a job. |
| `model.options` | Which providers are signed in, and the model picker |
| `delegation.status` | Live Worker (subagent) status |
| `mcp.servers.status` | Cached state of your MCP servers for the Services and Health cards: name, tool count and status only. It never connects to a server, and shows no URL, command or error text. |
| `cli.exec` | Runs `hermes usage` (below) |

It also reads, through the Desktop host (no plugin backend): `status` (gateway state, connected platforms, disk pressure, version) for the Services and Health cards; `skills.list` for the Skills card and to offer skills in Quick launch; and `logs` for the Logs card, which shows the last lines of the `agent`, `errors`, `gateway` and `gui` logs. Log lines come back already redacted by Hermes, are masked again in the page, shown on screen only, and never stored or synced. The Health card combines `status`, `cron.manage`, `mcp.servers.status` and the same per-provider usage read as the Usage card, so it triggers that read (below) even if no Usage card is on the page. It stores nothing of its own.

**Shell commands.** The only command it runs is `hermes usage --provider <slug> --json`, with `slug` taken from `model.options` for each signed-in provider the Usage card shows. It goes to `cli.exec` as an argument list (not through a shell) with a 60 second timeout. Providers that return no data are skipped for 60 minutes, and two run at a time at most.

**Reads outside the plugin's own data** (backend `dashboard/plugin_api.py`):

- `state.db` in the Hermes home, opened **read-only**, never written, for: Files made (`MEDIA:` paths in the newest 300 assistant messages of the chosen range that name a file, subagent and tool sessions excluded; the count shows a `+` when that cap was hit); Worker history (subagent sessions); Spend (the token, estimated-cost, cost-status and model columns of `sessions`, plus session titles; no message text); and Activity (for tool results: the tool name, time, session title and an ok/failed outcome derived from the result's `exit_code`, `success`, `error`, `message` and `status` fields; never the arguments or the result text).
- Memory card: the size and modified time of `memories/MEMORY.md` and `memories/USER.md` in the Hermes home, counted in characters and entries against the limits in your Hermes memory config, plus the name of an external memory provider if one is set. The text is never returned.
- Skills card: the `last_used_at` and `created_at` dates per skill from `skills/.usage.json` in the Hermes home (read only, at most 1 MB). Counts, paths and the rest of the file are not returned.
- For each file path listed, one existence check on the gateway machine. Network (UNC) paths are not touched.
- The latest output of a scheduled job, for the Job result card: the newest `.md` file in `cron/output/<job id>/` in the Hermes home, read **only** (first 64 KB, at most one file per request). The job id must be letters, digits, `_` or `-`, and the folder must stay inside `cron/output`. Nothing there is written, run or deleted.
- Live tasks card: Hermes' own Worker delegation transcripts under `cache/delegation/live/<id>/` in the Hermes home (`manifest.json` and `task-N.log`), read **only**, never written: at most the last 256 KB of each log, and symlinks are refused. Hermes redacts credentials in these files before writing them. From them the card shows each Worker's goal (up to 500 characters), model, tool names, Hermes' one-line tool preview (up to 220 characters), ok/failed, durations and the final status. Result text, thinking and the final summary are never read into the page.
- Live tasks card, from `state.db` (read-only): for the chats involved, the chat title, tool names, times and step counts; never tool arguments or message content. To find which chat started a batch, the first message of a subagent session is compared with the goal on the gateway and is never returned.
- Machine stats with `psutil`: CPU, load, memory, uptime, disk usage of the volume holding the Hermes home, and the machine's hostname. Nothing else is read from the machine.

**What it stores.**

- The layout document at `plugin-data/ultimate-dashboard/state.json` in the Hermes home: one per Hermes profile, shared by Desktop and the Webapp, at most 256 KB. It holds views, card options, Quick launch shortcuts (label, skill, prompt text, model), pinned job ids and your settings.
- A copy of that document in the plugin's app storage (`ctx.storage`) on the device running Desktop or the Webapp, plus a counter of Quick launch uses.
- The plugin stores no credentials and reads none itself. `hermes usage` (Shell commands above) runs on the gateway and uses the provider sign-ins Hermes already holds.

**Background activity.** The plugin starts no process of its own. While Hermes is open it uses timers owned by the plugin (they stop when the plugin is disabled): approvals are checked every 15 seconds while a session is waiting and every minute otherwise, and cards refresh at the interval you choose in Settings, or only when you press Refresh; the Usage card's `hermes usage` read repeats every 10 minutes (not at all with Refresh set to manual); the Live tasks card asks the backend's `/live` route every 5 seconds while a task runs, otherwise at the refresh setting (never faster than 15 seconds; Manually means no timer), and reads the last 30 days of Workers at most every 5 minutes for the usual-duration estimate; no model is called. To keep your layout in sync, the page pulls the plugin's own `/state` route every 30 seconds while the dashboard page or its settings are open, and when the window regains focus if the last pull is more than 5 seconds old. The plugin listens to these Hermes gateway events: `approval.request` (the optional "new approval" toast and a refresh), `approval.cancelled` (a refresh), `clarify.request` (the question text of a waiting session), `cron.changed` (re-reads the job list and Job result cards) and `message.complete` (clears that session's question and refreshes). Only the current (canonical) gateway protocol delivers them; on an older gateway approvals still appear through the 15-second check, without a toast.

**Who can see what.**

- Anyone who can sign in to your Hermes dashboard or Webapp can see, through this plugin, the session titles, file paths, scheduled job names and their latest output text (Job result card), approval commands, the Worker goals and command previews of the Live tasks card and the machine hostname the cards show, and can change the shared layout. The plugin adds no access check of its own beyond what the dashboard requires.
- Layout export (Settings → Layouts) copies the whole layout to your clipboard, **including the prompt text of your Quick launch shortcuts**. Do not put secrets in prompts, and read an export before you share it.

**Quick launch** opens a chat with the shortcut's text typed into the composer. Nothing is sent until you press Send. A shortcut with its own model creates the chat with that model (`session.create`), so it shows in your session list even if you send nothing.

## Troubleshooting

- Dashboard is not in the sidebar: the **Desktop** switch is off. Turn it on in **Capabilities → Plugins → Ultimate Dashboard**, in Desktop and in the Webapp.
- Cards say they are not available, or the page says it needs its backend: run `hermes plugins enable ultimate-dashboard` on the gateway machine, then `hermes gateway restart`. Do the same for every profile that should show data.
- The page still shows the old version after an update: restart the gateway. The backend only reloads on restart.
- The Usage card is empty: no signed-in provider reports plan usage.

## Uninstall

`hermes plugins disable ultimate-dashboard`, then `hermes plugins remove ultimate-dashboard`, then `hermes gateway restart`. Linked install (Option B): `remove` refuses a symlink, so delete the link yourself instead (`rm ~/.hermes/plugins/ultimate-dashboard`; on Windows delete the copied folder under `%LOCALAPPDATA%\hermes\plugins`). Your layout stays in `plugin-data/ultimate-dashboard/` until you delete it.

## Licence

MIT, see `LICENSE`.
