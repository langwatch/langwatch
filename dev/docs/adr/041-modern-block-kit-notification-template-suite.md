# ADR-041: Modern Block Kit notification template suite for trace automations and graph alerts

**Date:** 2026-07-10

**Status:** Proposed

## Context

[ADR-036](./036-liquid-templates-for-trigger-notifications.md) made trigger notifications customer-authorable Liquid, and shipped a **Block Kit allowlist v1** — only presentational blocks survive, interactive blocks are dropped, and every user-controlled value passes through `mrkdwn_escape` before `| json`. PR #5015 (the `tpl5015-*` markers and `GraphAlertTemplateContext` in `src/shared/templating/templateContext.ts:119-202`) added a second render context and three graph-alert templates alongside the six trace templates.

### What we ship today

Nine curated Block Kit presets in `src/automations/providers/definitions/slack/templates/registry.ts:59-168`, split by `kind` (`trace` | `graphAlert`) and `cadenceFit` (`immediate` | `digest` | `both`):

| id | kind | cadence | blocks used today |
|----|------|---------|-------------------|
| `trace_alert_compact` | trace | immediate | header, context, markdown ×2, context |
| `trace_alert_one_liner` | trace | immediate | section |
| `eval_failure_detailed` | trace | immediate | header, context, divider, markdown ×2, context |
| `digest_compact` | trace | digest | header, context, divider, section-per-row, context |
| `digest_evaluator_rollup` | trace | digest | header, context, divider, section-per-group, context |
| `digest_inline_rich` | trace | digest | header, context, divider, section + markdown ×2 per trace |
| `graph_alert_compact` | graphAlert | immediate | header, section(fields), context(sparkline), context |
| `graph_alert_detailed` | graphAlert | immediate | header, section(fields), context, section(history-as-mrkdwn-lines), context |
| `graph_alert_one_liner` | graphAlert | immediate | section |

The allowlist gating every rendered payload is `src/shared/templating/blockKitAllowlist.ts:18-24`:

```ts
export const ALLOWED_BLOCK_TYPES = ["section", "divider", "context", "header", "markdown"] as const;
```

with three hard security rails, all pinned by `__tests__/blockKitAllowlist.unit.test.ts`:
- **No accessories.** `ALLOWED_ACCESSORY_TYPES` is empty (`blockKitAllowlist.ts:30`) — section accessories can carry image URLs that fetch on render (tracking-pixel vector).
- **Context elements are text-only.** `ALLOWED_CONTEXT_ELEMENT_TYPES = {mrkdwn, plain_text}` (`blockKitAllowlist.ts:34`) — nested `image` elements are stripped recursively.
- **`image` is banned outright** — mirrors the email `<img>` ban (`markdown.ts:4-17`).

Escaping discipline (the trust boundary): truncate → `mrkdwn_escape` → `| json`, applied to every user-controlled field. `mrkdwn_escape` (`engine.ts:63-68`) neutralises `&`/`<`/`>` so authored content cannot forge mrkdwn links (`<https://evil|click>`) or broadcasts (`<!channel>`). Operator-controlled fields (`trigger.name`, `evaluatorName`) are left unescaped; the default templates model the pattern (`defaults.ts:181-236`, `:106-159`). Available custom filters: `mrkdwn_escape`, `json`, `truncate`, `date`, `url_encode`, `group_by`, `slice`.

### The two render contexts

- **`TemplateContext`** (trace) — `trigger`, `project`, `digest{count,windowStart,windowEnd}`, `match`, `matches[]`. Each match is `{ trace{id,input,output,url,metadata}, evaluation }` and **`evaluation` is a single object, not an array** (`templateContext.ts:56-75`). One immediate dispatch is `matches.length === 1`; a digest is N.
- **`GraphAlertTemplateContext`** (graphAlert) — `trigger{…,alertType}`, `graph{name,url}`, `metric{label,seriesName}`, `condition{operator,operatorLabel,threshold,timePeriodMinutes,timePeriodLabel}`, `currentValue`, `previousValue`, `sparkline`, `history[{timestamp,value}]`, `reason` (`real-time` | `heartbeat-absence` | `heartbeat-resolve`), `occurredAt`, `project` (`templateContext.ts:119-202`).

### The delivery channel — the binding constraint

Notifications post through **Slack incoming webhooks** (`IncomingWebhook` from `@slack/webhook`, `sendSlackWebhook.ts:1-10`), host-locked to `hooks.slack.com` by `slackWebhookGuard.ts`. Incoming webhooks reliably render the long-standing block types (`header`, `section`, `divider`, `context`, `actions`, `image`, `markdown`, `rich_text`). The **2024-2025 blocks — `table`, `data_visualization`, `video` — have undocumented incoming-webhook support** (Slack's reference does not state which surfaces accept them). Any template built on those must be gated behind a delivery probe, and may force a move to a bot-token `chat.postMessage` channel (a Slack-app OAuth lift, out of scope here).

### The gap

The current suite leans entirely on `section` + `context` + `markdown`:
- The graph-alert **trend is a unicode sparkline** (`▁▂▄▆█`, `templateContext.ts:243-262`) and **history is mrkdwn lines** — a real chart or table would read far better.
- **Digests are cramped section lists** — one `section` per trace; a `table` block turns a 10-trace digest into a scannable grid.
- **Trace I/O is quoted via a `## User` markdown-block hack** — `rich_text_quote` is the native primitive.
- **No lifecycle awareness** — a `heartbeat-resolve` (recovered) and `heartbeat-absence` (no data) fire the *same* `:rotating_light:` alarm as a breach, for lack of a reason-keyed variant.
- **No real call-to-action** — "Open dashboard" / "Edit alert" are context-block hyperlinks, not buttons, because `actions` is not allowlisted.

## Decision (proposed)

Ship a **modern Block Kit template suite** for both kinds, and **expand the allowlist in security-reviewed phases** to admit the blocks the suite needs. Every addition preserves the ADR-036 posture: presentational-only, recursive sanitisation of nested content, `mrkdwn_escape`+`| json` on all user-controlled values, no fetch-on-render vectors.

### Authoring modes — add a no-code "Template" tier

Today a Slack notification has **two** authoring modes, discriminated by `slackTemplateType` (`renderSlack.ts:93-128`): **plain text** (`'string'`) or **Block Kit code** (`'block_kit'`, raw Liquid-in-JSON edited by hand). Both put source in front of the user — overwhelming for a non-engineer who should never see a brace.

Add a **third, default tier: "Template" (guided)** — the author picks a curated preset and never touches code. The substrate exists: `SLACK_BLOCK_KIT_TEMPLATES` + `SlackBlockKitTemplatePicker` (`registry.ts:59-168`, `TemplatePicker.tsx:37-57`) is already a "pick a layout, we wrote the code" gallery with thumbnails. **Promote it to the primary surface and demote the code editor to opt-in.**

- **Pick by outcome, not syntax.** The author chooses *what they want to see* — "Pie chart", "Trend chart", "History table", "Incident card", "Rich trace card", "Digest table" — and we select the best-fitting preset. For graph alerts the chart type drives the choice: Pie/Bar/Line → the `data_visualization` template; Table → `table`; Card → `graph_alert_incident`. For trace data the presets surface the useful fields (I/O, evaluations, metadata, cost, latency) without the author assembling them.
- **Progressive disclosure — three escape hatches, in order of power:**
  1. **Synced preview** (read-only) — renders the chosen preset against real recent-match or example data (the ADR-037 pane), no code shown.
  2. **"Customise / edit the template"** — reveals the generated Liquid Block Kit in the editor, switching the draft to `block_kit` mode with the preset's source pre-filled. One-way: hand-edits are custom (the picker highlights nothing, as `findTemplateOptionBySource` handles — `registry.ts:201-205`).
  3. **"Switch to plain text"** — drops to `'string'` mode for the minimalists.
- **Copywriting** (per `dev/docs/best_practices/copywriting.md`): the guided tier says *what the message will contain* ("A trend chart of the metric with the breach highlighted"), never *how it is built*. "Liquid" / "Block Kit" jargon appears only once the author opts into the code editor.

**Schema.** The guided tier needs no new render path — a chosen preset is still stored as its rendered `slackTemplate` + `slackTemplateType: 'block_kit'`, so dispatch is unchanged. Two options for remembering the choice: **(a) stateless** — re-derive the preset by matching stored source via `findTemplateOptionBySource` (works today, but a hand-edit silently loses the guided affordance); or **(b) one nullable column** `slackTemplatePreset TEXT` recording the chosen preset id, so guided mode stays sticky and the picker re-highlights on reopen. Recommend (b) — a one-line migration (mirrors ADR-036's four nullable columns) making "guided vs customised" explicit and inspectable rather than a source-match heuristic.

This tier is *why* the curated suite matters: the better and broader the presets, the more people never see code at all.

### Allowlist additions

| Block / element | New? | Why | Security treatment | Webhook-safe? |
|-----------------|------|-----|--------------------|---------------|
| `rich_text` (+ `rich_text_section`, `rich_text_quote`, `rich_text_preformatted`, `rich_text_list`) | yes | Native quoted I/O, code blocks, lists | Recursively sanitise inline elements to `{text, link, emoji, date, color}`; **strip `broadcast`, `user`, `usergroup`, `channel`** (notification-abuse — same class as `<!channel>`). `link.url` scheme/host-validated. `text` elements are plain strings, so no mrkdwn forging is possible. | yes |
| `actions` + `button` | yes | Real "Open dashboard" / "View trace" / "Edit" CTAs | **url-only buttons**: require `url`, strip `action_id`/`value`/`confirm` (those POST callbacks — the thing ADR-036 banned). Validate `url` scheme=https + host ∈ {LangWatch app host, `slack.com`}. A url-only button opens a link, never calls back. | yes |
| `button` as section `accessory` | yes | Same CTA inline with a section | Same url-only restriction; extends `ALLOWED_ACCESSORY_TYPES` from `{}` to `{button}` under that restriction. | yes |
| `table` (+ `raw_text`, `raw_number`, `rich_text` cells) | yes | Digest-as-grid; alert history-as-grid | Cap rows (≤ digest cap), reuse the `rich_text` cell sanitiser; escape `raw_text`; enforce the 10,000-char aggregate cap. | **unverified — probe first** |
| `data_visualization` | yes | Native line/bar chart of `history` (replaces the sparkline) | Low risk: renders natively, **no external fetch**. Escape series/point labels; cap at Slack's 12 series × 20 points. | **unverified — probe first** |
| `image` | no — **stays banned** | — | Tracking-pixel vector; `data_visualization` supersedes the chart use case. | — |

### Proposed templates — graph alerts (`kind: graphAlert`)

| id | name | cadence | new blocks | dependencies |
|----|------|---------|-----------|--------------|
| `graph_alert_incident` | Incident card | immediate | `rich_text` (or `table`) for history, `actions` (url buttons) | none |
| `graph_alert_chart` | Native chart card | immediate | `data_visualization`, `actions` | webhook probe |
| `graph_alert_history_table` | History table | immediate | `table`, `actions` | webhook probe |
| `graph_alert_resolved` | Recovered / resolved | immediate | none (reason-keyed) | none |
| `graph_alert_no_data` | No-data heartbeat | immediate | none (reason-keyed) | none |
| `graph_alert_one_liner` | One-liner *(exists — keep)* | immediate | — | — |

**`graph_alert_incident`** — the rich default. `header` (severity emoji + `trigger.name`) → `context` (`*Alert type:* {{trigger.alertType}}` + `occurredAt`) → `section(fields)`: *Metric*, *Condition*, *Current value* (`{{currentValue}}` vs `{{previousValue}}` + delta) → `rich_text` rendering `history` as a `rich_text_list` (or a `table` of Time | Value once the probe passes) instead of the mrkdwn sparkline → `actions` with url-only *Open dashboard* (`graph.url`) and *Edit alert* (`trigger.editUrl`). Severity colour comes from the emoji + `alertType` (Block Kit has no per-block colour outside attachments).

**`graph_alert_chart`** — `header` → `section(fields)` → `data_visualization` line chart (one series `metric.label`, `data` = `history` mapped to `{label,value}`, axes from `metric.label`/`condition.timePeriodLabel`) → `actions`. The headline modern template — a real chart in-channel, no image fetch.

**`graph_alert_resolved`** — keyed on `{% if reason == "heartbeat-resolve" %}`. `header` (✅ "Recovered: {{trigger.name}}") → `section` ("*{{metric.label}}* is back within threshold") → `section(fields)` (was `{{previousValue}}` / now `{{currentValue}}`) → `context` → `actions`. Closes the correctness gap where recovery fires the breach alarm. Renders **nothing new** — safe today.

**`graph_alert_no_data`** — keyed on `{% if reason == "heartbeat-absence" %}`. `header` (🔇 "No data: {{trigger.name}}") → `section` ("No qualifying data in the {{condition.timePeriodLabel}}") → `context` (last-seen) → `actions`. Also allowlist-clean.

### Proposed templates — trace automations (`kind: trace`)

| id | name | cadence | new blocks | dependencies |
|----|------|---------|-----------|--------------|
| `trace_card_rich` | Rich trace card | immediate | `rich_text` (quote blocks), `actions` | none |
| `trace_eval_scorecard` | Evaluation scorecard | both | `section(fields)` per evaluator, `actions` | **per-trace `evaluations[]` array** |
| `digest_table` | Digest — table | digest | `table`, `actions` | webhook probe |
| `eval_failure_rich` | Eval-failure detail (rich) | immediate | `rich_text` (quote + preformatted) | none |
| `digest_compact` | Digest — compact *(exists — keep)* | digest | — | — |

**`trace_card_rich`** — `header` (`trigger.name`) → `context` (evaluator + score + `alertType`) → `rich_text` with a `rich_text_quote` for **Input** and another for **Output** (native quoting, replacing the `## User` hack in `trace_alert_compact.liquid`), optionally a `rich_text_preformatted` for JSON-looking values → `actions` (*View trace*). I/O lands in plain `text` inline elements, so no mrkdwn forging is possible.

**`trace_eval_scorecard`** — `header` → `section(fields)` one field per evaluator (`✅`/`🛑` + name + score) → `context` → `actions`. **Requires a new context field** `match.evaluations[]` (today `match.evaluation` is single, `templateContext.ts:70-75`). Until it lands, degrades to the single evaluation.

**`digest_table`** — the standout digest upgrade. `header` → `context` (`{{digest.count}} matches · window`) → **`table`**: columns *Score* | *Evaluator* | *Input* (snippet) | *Link* (rich_text cell), one row per trace (`{% for m in matches limit: N %}`) → `context` "See all N in LangWatch". Turns the cramped `digest_compact` list into a grid. Gated on the `table` probe.

**`eval_failure_rich`** — upgrade of `eval_failure_detailed`. `header` (🛑 keyed on `passed == false`) → `context` → `divider` → `rich_text` (`rich_text_quote` Input, `rich_text_quote` Output, `rich_text_preformatted` for structured payloads) → `actions`.

### Build-first (top 3)

1. **`graph_alert_resolved` + `graph_alert_no_data`** *(no allowlist change)* — highest value / lowest cost. **Zero** new blocks (only `reason`-keyed Liquid + registry/wireframe wiring) and they close a real correctness gap (recovery and no-data both fire the breach alarm today). Ship first.
2. **`trace_card_rich` + `eval_failure_rich`** *(add `rich_text`)* — `rich_text` is confidently webhook-safe (the Slack composer's native output), presentational, and gives the biggest readability win: native quoted I/O over the `## User` hack. Medium cost (allowlist entry + recursive inline sanitiser), low delivery risk.
3. **url-only `actions` / `button` accessory** *(cross-cutting)* — unlocks real *Open dashboard* / *View trace* / *Edit* CTAs on **every** template, both kinds. Modest allowlist work but the security review is load-bearing (url-only restriction + scheme/host validation), so it earns its own slice.

`table`/`data_visualization` templates (`digest_table`, `graph_alert_chart`, `graph_alert_history_table`) are **Phase 3**, gated on a delivery-channel probe against a real `hooks.slack.com` webhook; if rejected, they wait on the bot-token `chat.postMessage` channel.

### Phasing

- **Phase 0 — no-code "Template" tier** (UI + optional one-column migration, no allowlist change): promote the picker to default, demote the code editor to opt-in, add the synced preview and two escape hatches. Independent of the block work — makes *every* existing and future preset usable by non-engineers, so it can land alongside or ahead of Phase 1.
- **Phase 1 — reason-keyed graph-alert lifecycle** (no allowlist change): `graph_alert_resolved`, `graph_alert_no_data`.
- **Phase 2 — `rich_text` + url-only `actions`**: `trace_card_rich`, `eval_failure_rich`, `graph_alert_incident`, plus buttons retrofitted into existing templates. Extends `ALLOWED_BLOCK_TYPES`, adds a `rich_text` inline sanitiser and a url-only button sanitiser, extends `ALLOWED_ACCESSORY_TYPES` to `{button}`.
- **Phase 3 — `table` + `data_visualization`** (behind a webhook probe): `digest_table`, `graph_alert_chart`, `graph_alert_history_table`. If the probe fails, land the Slack-app bot-token channel first.

### Per-addition wiring (every new template needs all four)

1. **`.liquid` source** in `templates/` + `?raw` import + entry in `SLACK_BLOCK_KIT_TEMPLATES` (`registry.ts:59-168`), and the id added to the `SlackBlockKitTemplateId` union (`registry.ts:24-33`).
2. **Wireframe** in `wireframes.tsx` — lifecycle variants reuse existing `WireKind`s; **`table`, `rich_text`-quote, `chart`, and `button`/`actions` need new `WireKind`s** (`wireframes.tsx:3-11,83-167`) so the thumbnail reflects the real structure.
3. **`kind` / `cadenceFit`** on the option so `templateOptionsFor` (`registry.ts:187-199`) and the picker (`TemplatePicker.tsx:37-57`) surface it only for the matching kind/cadence; update `pickDefaultSlackBlockKitTemplateId` (`registry.ts:172-185`) if a new template should become a default (e.g. `graph_alert_incident` replacing `graph_alert_compact`).
4. **Allowlist + tests** — the block added to `blockKitAllowlist.ts` with a pinning test in `__tests__/blockKitAllowlist.unit.test.ts` proving the sanitiser strips the interactive/abuse variants (callback buttons, `broadcast`/mention inline elements, image cells).

### Security review — the pinning test per new block

Each block's sanitiser (per the allowlist-additions table above) gets a pinning
test that feeds the abuse variant and proves it is stripped: `rich_text` a hostile
`broadcast`-laden payload; `actions`/`button` a callback button (`action_id`/`value`/
`confirm`); `table` an image-bearing rich_text cell; `data_visualization` a payload
with a fetchable URL. Every addition keeps the `truncate → mrkdwn_escape → | json`
order for user-controlled values.

### New context data (dependencies to emit)

- **`match.evaluations[]`** (per-trace evaluator array) — required by `trace_eval_scorecard`; today the context exposes a single `match.evaluation` (`templateContext.ts:70-75`). A `buildTemplateContext` change (`templateContext.ts:447-497`) fed by the dispatch layer.
- **Chart image URL** — *not* required with `data_visualization` (native render, no fetch). An image-based chart would need the `image` ban lifted (a tracking-pixel regression we reject) plus a signed chart-image URL — so `data_visualization` is the sanctioned path.
- **Delivery-channel capability probe** — a one-off test posting `table` / `data_visualization` payloads to a real incoming webhook, recording pass/fail, before any Phase-3 template ships.

## Consequences

- **The allowlist grows but the posture holds.** Each new block is admitted only with a recursive sanitiser and a pinning test; the "presentational-only, no fetch-on-render, escape-then-json" contract from ADR-036 is preserved verbatim. `image` stays banned.
- **`actions` reverses part of ADR-036's "strip all interactive" stance — narrowly.** Scoped to *url-only* buttons, which never POST a callback, so the original ban's reason (LangWatch becoming a receiver for customer interactions) does not apply. This nuance must be spelled out in the allowlist comment so a future reader does not "tidy" the button path back into a callback vector.
- **`table` / `data_visualization` may be blocked by the delivery channel.** If the probe fails, the grid/chart templates depend on landing a bot-token `chat.postMessage` channel (Slack-app OAuth) — a larger, separate initiative.
- **Picker real estate.** Adding ~7 templates roughly doubles the graph-alert and digest option sets; the `SimpleGrid` (`TemplatePicker.tsx:68-86`) handles variable counts, but curation (defaults vs "more layouts") matters more as the list grows.
- **The reason-keyed lifecycle variants are free wins** — no allowlist change, and they fix a genuine alarm-fatigue bug where recovery/no-data masquerade as breaches.
- **The no-code "Template" tier changes who can configure alerts** — the highest-leverage part of this proposal. It makes the entire preset suite reachable without reading a line of Liquid, turns "pick a chart type" into the primary interaction, and keeps the code editor as a power-user opt-in. It reuses the existing picker and render path, so its cost is UI plus at most one nullable column — cheap relative to its reach.

## References

- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid templates + Block Kit allowlist v1 (this ADR extends its allowlist)
- [ADR-037](./037-automation-operator-surfaces.md) — authoring drawer / live preview that renders these templates
- [ADR-040](./040-webhook-http-request-automation-channel.md) — the generic webhook channel, adjacent automation surface
- PR #5015 — graph-alert Slack templates + `GraphAlertTemplateContext` (the `graphAlert` kind this suite builds on)
- Slack Block Kit reference — https://docs.slack.dev/reference/block-kit/blocks/ (`table`, `rich-text`, `data-visualization`, `section`, `markdown` block pages)
