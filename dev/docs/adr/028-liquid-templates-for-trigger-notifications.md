# ADR-028: Liquid templates for user-customizable trigger notifications

**Date:** 2026-05-28

**Status:** Accepted

## Context

Today's trigger emails and Slack messages are hardcoded. A trigger has `name`, `message`, and `alertType`; the dispatched message is rendered from a fixed React email template (`sendTriggerEmail`) or a fixed Slack payload builder (`sendSlackWebhook`). Customers can change a small set of strings, but cannot change subject lines, message body structure, rich formatting, or which trace attributes are surfaced.

Enterprise customers regularly ask for:

- Custom subject lines with project / severity / metadata interpolation.
- Slack Block Kit messages with their own branding and layout.
- Specific trace-attribute callouts in email bodies.
- Conditional content (e.g., only show evaluation details if the trigger fires on an evaluation completion).

Customer-supplied templates are server-evaluated. The security boundary is critical: the template engine must not allow arbitrary code execution, filesystem access, or unbounded recursion. The product also needs the system to degrade gracefully — a customer template that throws or references missing variables must not break the dispatch path.

[ADR-023](./023-per-trigger-dispatch-timing.md) introduces cadence and digest semantics. The template system must work for both single-match (`length === 1`) and digest (`length > 1`) cases without forcing the customer to write two templates.

## Decision

Adopt **`liquidjs`** as the template engine for trigger notifications.

### Schema

Four new nullable columns on `Trigger`:

```sql
ALTER TABLE "Trigger"
  ADD COLUMN "slackTemplateType"     TEXT,           -- 'string' | 'block_kit' | NULL
  ADD COLUMN "slackTemplate"         TEXT,           -- Liquid source
  ADD COLUMN "emailSubjectTemplate"  TEXT,           -- Liquid source
  ADD COLUMN "emailBodyTemplate"     TEXT;           -- Liquid source (Markdown)
```

`NULL` means "render with the framework-provided default template." Existing triggers have all four NULL, see no visible change.

### Engine configuration

```ts
const engine = new Liquid({
  strictFilters: true,
  strictVariables: false,   // missing vars render as empty string, no throw
  cache: true,              // LRU of compiled templates, default 1k entries
});
```

- **500ms render timeout** per template invocation. Liquid loops over hostile-sized input are bounded.
- **`p-limit` concurrency cap of 10** on the dispatch worker's Liquid+Markdown render pipeline so a slow render doesn't starve sibling rows.

### Email

Body is Liquid → Markdown → HTML via `marked` + an email-safe sanitizer + the existing email wrapper layout (header, footer, logo).

Subject is Liquid → string, single line, clipped to 200 chars with `…` on overflow.

### Slack

Explicit type discriminator: `slackTemplateType: 'string' | 'block_kit'`.

- `'string'`: Liquid output sent as a plain `text` payload.
- `'block_kit'`: Liquid output is parsed as JSON and sent as a `blocks` payload. JSON parse failure → fall back to default template, log, surface in operator activity tab (ADR-026).

Block Kit allowlist v1: `section | divider | context | header | image`. Interactive elements (`button`, `actions`, `input`, etc.) are stripped before sending — Slack accepts callbacks on interactive elements, and we do not want customer-authored Block Kit posting back to LangWatch.

### Template variables

A single contract for both single-match and digest cases:

```ts
{
  trigger:  { id, name, message, alertType },
  project:  { name, slug, url },
  digest:   { count, windowStart, windowEnd },   // count === 1 for immediate
  matches: [{
    trace:      { id, input, output, url, metadata, ... },
    evaluation: { score, passed, label, evaluatorName }   // null for trace-only triggers
  }],
}
```

Templates always iterate `{% for m in matches %}`. Immediate dispatches set `matches.length === 1`; digests set it to N. The same template handles both cases — no `{% if digest %}` branch needed.

### Validation

- On `Trigger` save (Hono + tRPC): run `validateLiquid` on every non-null template column. Reject save with a syntax error message.
- On render: try/catch the Liquid call. On failure, render the default template, log + capture, surface "rendered with the default template due to template error" in the operator activity tab (ADR-026).
- On Block Kit JSON parse failure: same fall-back-to-default semantics.

### Test fire banner

When dispatched via `dispatchOnce` (the "Test fire" UI button), the backend prepends a **non-suppressible banner** to the rendered output:

- Slack: leading `section` block with text "**TEST FIRE** — sent by the trigger test button, not by a real match."
- Email: subject prefix `[TEST] `; body prepends the same notice in a styled callout.

Banner is backend-injected and NOT template-controllable.

## Rationale

### Why `liquidjs`

- **Sandboxed by design.** No arbitrary JavaScript, no filesystem access, no `eval`. Template authors cannot escape into Node.js context.
- **Well-known syntax.** Shopify and Jekyll have made Liquid the de-facto "user templates" language for the web. Friendly to non-engineers.
- **Active TypeScript implementation.** `liquidjs` is the reference port, maintained, typed, fast.
- **Customizable filters.** We can add LangWatch-specific filters (e.g. `{{ trace.input | truncate: 200 }}`) without forking the engine.

### Rejected alternatives

- **Handlebars.** Similar feature set, but the JavaScript Handlebars implementations have a history of sandbox-escape CVEs; `liquidjs`'s sandboxed-by-design model is a better starting point.
- **JSX / React templates.** Too powerful — full JS evaluation. Wrong security model for customer-authored content.
- **No customization (hardcoded forever).** Rejected by customer feedback and competitive pressure.
- **Mustache / EJS.** Mustache is too restrictive for the conditionals customers want; EJS is too permissive (full JS) for the security boundary.

### Why explicit `slackTemplateType` and not auto-detect

Auto-detecting ("if rendered output starts with `{` or `[`, treat as Block Kit JSON; else plain string") was considered and rejected. It surprises customers whose plain-text starts with a brace (template starting with `{% if %}` directives that render to a plain string starting with `{`), and obscures intent. Explicit discriminator is cheap.

### Why a Block Kit allowlist

Block Kit supports interactive elements that POST callbacks. Allowing customer-supplied JSON to include `button`/`actions`/`input` blocks means LangWatch becomes the receiver for arbitrary customer-defined interactions. v1 strips all non-allowlisted blocks; we'll consider supporting specific interactive types later if a customer use case justifies it.

### Why `matches[]` array shape always

Letting templates branch on `{% if digest %}` would double the surface area customers must understand. Treating immediate as "a digest of length 1" collapses the cases. Customers writing `{% for m in matches %}` get correct behavior in both modes from one template.

### Why fall-back-to-default on render failure

Silent failure of customer-authored content (with operator visibility) is strictly better than blocking dispatch entirely. The customer gets *something* useful (the default message) and operators see the rendering error in the activity tab; the alternative is the customer getting nothing and having to debug from logs.

### Why a shared module under `src/shared/templating/`

Both server-side dispatch (renders the actual notification) and the UI (renders the live preview in the authoring drawer) call into the same engine. Putting it under `src/shared/templating/` rather than `src/server/...` keeps the client bundle free of server-only AsyncLocalStorage / logger transitive imports.

## Consequences

- **Four new nullable `Trigger` columns.** Single `ALTER TABLE`; trivial migration.
- **New module at `src/shared/templating/`** wrapping engine setup, render, validation, and the Block Kit allowlist. The rendering surface — sandboxed user templates with a digest `matches[]` shape — is reusable by any future outbox reactor that needs customer-customizable output.
- **Default templates extracted from current hardcoded output.** Existing customers see no change.
- **Operator-facing surfaces** (ADR-026):
  - Split-pane editor with live preview (Monaco + Liquid mode).
  - Email preview: Liquid → Markdown → HTML rendered with the same wrapper as production.
  - Slack preview: in-app renderer for the allowlist + "Open in Slack Block Kit Builder" deep-link.
  - Preview uses real recent-match data when available, synthetic stub otherwise.
- **Performance budget.** 100-match digest × Liquid render × Markdown render × sanitize is ~50–200ms in Node. Acceptable for a worker. `p-limit` 10 prevents a slow render from starving siblings.
- **`strictVariables: false` trade-off.** Missing variables render silently. Mitigation: the operator activity tab (ADR-026) surfaces "rendered with N missing variables: [list]" so authors learn about typos without dispatch failures.
- **Future work, deferred until customer ask**: template versioning, partials/includes (`{% include %}`), per-project default templates, interactive Block Kit support, daily/weekly digest cadences.

## References

- [ADR-022](./022-transactional-outbox-for-stake-sensitive-dispatch.md) — outbox dispatch is the renderer's caller
- [ADR-023](./023-per-trigger-dispatch-timing.md) — cadence model that produces `matches[]` of varying length
- [ADR-026](./026-automation-operator-surfaces.md) — drawer that surfaces the live preview and template-health warnings
- `liquidjs` — https://liquidjs.com (engine choice)
- `marked` — Markdown → HTML for email body
