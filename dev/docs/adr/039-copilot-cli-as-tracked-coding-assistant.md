# ADR-039: GitHub Copilot as a tracked coding assistant

**Date:** 2026-07-10 (CLI) · extended 2026-07-14 (app)

**Status:** Accepted (CLI, §Decision · app, §Extension)

> `langwatch copilot` is a first-class wrapped tool with both paths — gateway via BYOK env vars and direct OTLP via native OTel — defaulting to ingestion (sourceType `copilot_cli`), extracted by `copilot.ts`. The standalone Copilot app is captured on the same `copilot.ts` extractor by injecting the same direct-OTLP env at app launch (sourceType `copilot_app`), delivered by a user login agent.

## Context

The governance wrapper (`langwatch claude|codex|gemini|opencode`) tracks coding-assistant usage through two mutually exclusive per-run paths: Path A routes LLM traffic through the AI Gateway with a personal virtual key; Path B injects `OTEL_EXPORTER_OTLP_*` env vars and a minted personal ingest key (`ik-lw-*`) so the tool exports its own telemetry to `/api/otel`. All ingest lands on the unified observability substrate (ADR-018).

GitHub Copilot CLI is the highest-adoption assistant not yet covered. Research (2026-07-09, verified against official GitHub docs) established that Copilot CLI ≥ 1.0.41 has every surface the wrapper needs:

- **Native OTel**: `COPILOT_OTEL_ENABLED=true` + standard `OTEL_EXPORTER_OTLP_*` vars; GenAI-semconv spans (`invoke_agent` / `chat` / `execute_tool`) carrying `gen_ai.usage.input_tokens` / `output_tokens`, premium-request consumption, `github.copilot.git.repository` / `github.copilot.github.org`, hashed `enduser.pseudo.id`. Spans/span-events only — no standalone log records. otlp-http only (grpc config silently falls back). Content capture is a separate opt-in (`captureContent`).
- **BYOK redirection**: `COPILOT_PROVIDER_BASE_URL` + `COPILOT_PROVIDER_TYPE=openai|anthropic|azure` + `COPILOT_PROVIDER_API_KEY` redirects all LLM traffic to any compatible endpoint. Without BYOK, traffic goes to `api.githubcopilot.com` on GitHub auth and cannot be intercepted.
- **Enterprise managed settings** (GA 2026-07-08): a `managed-settings.json` OTel config **overrides env vars**.
- Also present but not load-bearing here: Claude-compatible hooks (payloads carry no tokens/content) and `~/.copilot/session-state/*/events.jsonl` transcripts (explicitly unversioned — github/copilot-cli#3551).

Constraints confirmed at framing (2026-07-10): the no-double-trace rule holds; Copilot must reuse the existing wrapper machinery (no parallel wrapper); capture-everything is the default (mirroring claude's four OTel knobs); everything persisted must be removable by `langwatch logout`.

Forcing function: governance program expansion — Copilot is the biggest gap in the org-tracking story. Blast radius: data-pipeline (wrong span mapping pollutes traces/analytics; fat-payload risk in ClickHouse when content capture is on); no billing-money path.

## Decision

1. **Full tool integration, both paths.** `langwatch copilot` registers alongside the other four in `sdks/typescript/src/cli/program.ts` → `wrap.ts` → `runWrapped("copilot")`. Rejects the Path-B-only scope: both paths are cheap given the research, and a half-integration (cursor's hidden gateway-only command) demonstrably rots.

2. **sourceType is `copilot_cli`.** `copilot_studio` already exists (ADR-018, Microsoft Copilot Studio S3 audit feeds); a bare `copilot` slug would be confusable in the API-keys page and analytics filters, and `github_copilot` would collide again if Copilot IDE telemetry is ever ingested. The command name stays `copilot`; slug ≠ command follows the `claude` → `claude_code` precedent. The mint endpoint takes free-form `source_type` (`auth-cli.ts:1300`) — no server enum migration.

3. **Ingestion-first default — a deliberate deviation from the hasVk→gateway heuristic.** When no mode is pinned, copilot defaults to `ingestion` even when a VK is present. Why: Path A switches Copilot into BYOK mode, silently moving spend from the user's already-paid Copilot seat to the org's provider API keys. For claude/codex the base-URL swap is billing-neutral (API key either way); for copilot it is not. **Seam correction (v2):** the production default is selected in `resolveWrapperPath` (`wrapper-path-choice.ts`), which always passes a `forcedMode` into `resolveWrapperMode` — a copilot exception written only into `resolveWrapperMode`'s fallback would be dead code. **Complete gateway-default inventory (v3):** `resolveWrapperPath` defaults to gateway in **three** places, and all three flip to `ingestion` for copilot: the non-TTY/CI fallback (`wrapper-path-choice.ts:255`), the interactive prompt's pre-selection (`initial: 0`, line 272), and the **prompt-abort path** (Ctrl-C, line 279 — v2 missed this one; an aborted prompt must not silently opt a copilot user into gateway billing). The billing concern also applies to two later fallbacks: the policy-downgrade (`wrapper-mode.ts:188`) **and the ingestion-mint-failure fallback in `runWrapped` (`wrapper.ts:471-489`, e.g. control plane unreachable)** — both route copilot onto the gateway mid-run, and both notices must state that spend moves off the user's Copilot seat; the generic "routing/falling back to the gateway" lines are insufficient for copilot. Rejects "same as other tools" (surprise cost shift) and "always prompt" (the wrap-path-choice UX already prompts when both paths are allowed and no preference exists; this decision only changes the defaults inside that flow). **[Superseded in part — see v6:** #6343 later made ingestion-first the universal wrapper default and removed the mint-failure gateway fallback, so the copilot-specific flips are gone; only the seat-bypass wording on the remaining gateway routes stays copilot-specific.**]**

4. **Path A impersonates OpenAI, always.** `envForTool("copilot")` sets `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_BASE_URL=<gateway>`, `COPILOT_PROVIDER_API_KEY=<vk>`. One code path; the gateway's OpenAI-compatible surface routes to any configured upstream, with model aliases handling Claude-family names. Rejects per-org anthropic/openai branching (a special case no other tool has) and a per-tool admin knob (schema + UI for a setting nobody will touch). `TOOL_PROVIDER_FAMILIES.copilot = ["openai", "anthropic"]` so preflight accepts either upstream being configured.

5. **Path B env block mirrors claude's capture-everything policy, with a locked degradation ladder for content capture.** `buildOtelEnvBlock("copilot")` sets `COPILOT_OTEL_ENABLED=true`, exporters `otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, endpoint + Bearer header, `OTEL_RESOURCE_ATTRIBUTES=service.name=copilot-cli`. Content capture (`captureContent`) is enabled by default per the capture-everything constraint. The exact mechanism (env var vs config write) is spike-verified, but the **degradation is locked now**: attempt env var → fall back to an idempotent config write with opencode-flag semantics (never overwrite an explicit user `false`; register the write in `telemetry-targets.ts`) → if neither works, print a one-line "content capture unavailable — traces will carry tokens only" warning. Never silently run tokens-only. If the mechanism is an env var it joins `buildOtelEnvBlock` and is therefore covered by `telemetryEnvVarNames()` for logout strip symmetry automatically. `buildOtelEnvBlock("copilot")` must also explicitly set `COPILOT_OTEL_EXPORTER_TYPE` to the OTLP value (exact string spike-verified) — a user who previously configured the file exporter (`COPILOT_OTEL_EXPORTER_TYPE=file`, from a prior file-exporter setup) would otherwise inherit it from the parent env and silently redirect all telemetry to a local file: Path B alive-but-dead, the "copilot shows nothing" class. Set-explicitly is chosen over a clears entry because ingestion-mode results carry no `clears` mechanism today (`clears` only propagates on gateway returns) and overriding the key is strictly simpler than building one.

6. **Extractor: `copilot.ts`, thin and specifics-only, riding the extractor chain.** The canonicalisation pipeline runs extractors as a **chain** — every extractor applies to every span — and `GenAIExtractor` (registered at chain position 2, gated on `gen_ai.*` presence) **already canonicalizes Copilot's standard semconv attributes with zero new code**. So `copilot.ts` is a dedicated, thin extractor registered **after** `GenAIExtractor`, reading only the Copilot specifics: premium-request consumption, `github.copilot.*` repo/org attrs, `enduser.pseudo.id`, content payloads. Where it needs standard parsing primitives it imports them from the shared `_extraction.ts`/`_messages.ts` modules (the same primitives `genAi.ts` consumes) — never a re-implementation. It must not re-`take()` attributes GenAIExtractor already consumed. This preserves the locked fork's intent (dedicated named file, no duplicated logic) with even less code than the draft assumed. Rejects a fully independent extractor (duplicated semconv logic that drifts) and rejects folding lifts into `genAi.ts` itself (Copilot specifics leaking into the generic path).

7. **Persistence for bare `copilot` runs: scoped shell function — and NOT the global gateway export block.** Copilot joins `SHELL_FUNCTION_TOOLS` in `telemetry-targets.ts` (alongside `gemini`, `opencode`) — a marker-bracketed rc function whose install path (`shell-rc.ts` scoped-function persist) is generic and carries tool-specific vars like `COPILOT_OTEL_ENABLED` without changes (verified: gemini's `GEMINI_TELEMETRY_*` vars already ride it). **Copilot must NOT be added to `shell-rc.ts`'s `TOOLS` const** — that list feeds `buildExportBlock`, the global gateway export block, and adding copilot there would persist `COPILOT_PROVIDER_*` BYOK vars into every shell, forcing every bare `copilot` into gateway billing — the exact shift Decision 3 forbids. Rejects writing Copilot's own config (env-injection surface unverified; managed settings can override it) and wrapper-only capture (loses all habit-driven bare runs).

8. **Managed-settings conflict: detect + warn, continue — mode-independent.** The wrapper checks the OS-specific managed-settings locations; when an enterprise OTel pin exists, print one stderr line ("enterprise policy routes copilot telemetry elsewhere; LangWatch capture may be incomplete") and proceed. `preflightWrapper` only runs on the gateway branch, and copilot's default is ingestion — so this check (and Decision 9's) runs as a copilot-specific pre-spawn step in `runWrapped`, independent of the resolved mode. Rejects hard-fail (blocks users who still want gateway mode) and ignore (the "copilot shows nothing" silent-failure class).

9. **Version gate: warn below 1.0.41, mode-independent.** `copilot --version` before spawn (same pre-spawn step as Decision 8); older versions get a one-line upgrade warning and run anyway. Matches the graceful-degradation posture used for codex/gemini version quirks. Rejects a hard minimum (stricter than any existing tool, and copilot auto-updates).

10. **Hooks and events.jsonl are out of scope for v1.** Copilot's OTel carries both tokens and content — unlike codex, whose contentless OTel forced the rollout-tailing harvester. Hook payloads add no token/content data; the transcript format is unversioned. Revisit only if the dogfood spike (Open questions) finds captureContent gaps.

## Constants

| Name | Value | Purpose |
|---|---|---|
| Tool command | `copilot` | `langwatch copilot` wrapper subcommand; child binary name |
| sourceType slug | `copilot_cli` | ingest-key provenance; `SOURCE_TYPE_BY_TOOL.copilot` |
| `COPILOT_OTEL_ENABLED` | `"true"` | unlocks Copilot's native OTel export |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `"http/json"` | Copilot is otlp-http only; matches receiver default |
| `OTEL_RESOURCE_ATTRIBUTES` | `service.name=copilot-cli` | analytics grouping + source labeling (extraction gates on `gen_ai.*` presence, NOT service.name) |
| `COPILOT_OTEL_EXPORTER_TYPE` | OTLP value (exact string spike-verified) | defends against an inherited `=file` redirect (Decision 5) |
| `COPILOT_PROVIDER_TYPE` (Path A) | `"openai"` | gateway wire format (Decision 4) |
| Min. warned version | `1.0.41` | first version with the current OTel attribute set |
| Platform policy defaults | `allowVk: true, allowOtelDirect: true` | both paths available unless org admin disables |
| Provider families | `["openai", "anthropic"]` | preflight upstream check |
| captureContent | on by default; mechanism spike-verified (env var vs config write) | Decision 5 — degradation ladder locked, exact knob name lands with the spike |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| No double trace | A run never has gateway capture AND OTel emission for the same calls | mode exclusivity in `resolveWrapperMode` is **not sufficient**: a previously persisted Path-B rc function survives into gateway runs — the wrapper spawns via `$SHELL -i -c '…; copilot "$@"'`, the sourced rc defines `copilot() { OTEL vars… command copilot }`, and the function's env-prefix applies at invocation, AFTER the wrapper's reapply exports → gateway capture + OTel emission. Gateway-mode reapply must prepend `unset -f copilot 2>/dev/null` (kills the function, keeps aliases). Test anchor: gateway-mode spawn with a persisted rc function emits no OTLP. NOTE: this hole is pre-existing for gemini/opencode — fix generically for all `SHELL_FUNCTION_TOOLS` in the same PR (sweep item) |
| Logout symmetry | Every persisted artifact is discoverable + removable | shell function via existing `toolMarkers("copilot")`; any captureContent config write registered in `scanTelemetryTargets()`; env-var strips via `telemetryEnvVarNames("copilot")` — extend `logout.feature` |
| Billing neutrality by default | Default path never silently moves spend off the user's Copilot seat | ingestion-first default in **`resolveWrapperPath`** (Decision 3) — unit test on `resolveWrapperPath`: `hasVk=true, no pin, non-TTY → ingestion` for copilot only (a `resolveWrapperMode`-only test would pass while production does the opposite — the seam matters) |
| Ingestion is wired, not fallthrough | `SOURCE_TYPE_BY_TOOL.copilot` exists — a missing entry makes `resolveWrapperMode` silently fall back to gateway, reintroducing the billing shift | unit test: copilot ingestion mode mints a `copilot_cli` key, never returns gateway shape |
| TenantId scoping | Copilot spans land project-scoped like all ingest | existing ingest-key → hidden-governance-project binding (ADR-018); no new write path |
| Fat-payload safety | captureContent bodies cannot OOM the fold | `capOversizedAttributes` (span path: walks `span.attributes` AND `span.events[].attributes`, 256KB/value, unconditional on recordSpan) — NOT the claude raw-bodies guards, which are log-path only. Matrix test: oversized content on span **events**, plus a many-span accumulation case (the CH-merge OOM vector is fold accumulation, not one big value) |
| No attribute spoofing | `langwatch.origin.*` / `langwatch.ingestion_source.*` rejected from user OTLP | existing receiver edge stamping (ADR-018), unchanged |

## Schema

No Prisma migration. `IngestionSource.sourceType` and the mint endpoint accept free-form strings; `copilot_cli` is a new value, not a new column. ClickHouse untouched — spans ride the existing `recorded_spans` pipeline.

Touched surfaces (implementation map, not schema):

```text
sdks/typescript/src/cli/program.ts                  — register `copilot` command
sdks/typescript/src/cli/commands/wrap.ts            — wrapCopilot shim
utils/governance/wrapper.ts                         — envForTool copilot case (Path A), TOOL_PROVIDER_FAMILIES,
                                                      copilot pre-spawn step (managed-settings + version warnings,
                                                      mode-independent — preflightWrapper only runs on gateway),
                                                      gateway-mode reapply prepends `unset -f <tool>` for all
                                                      SHELL_FUNCTION_TOOLS (no-double-trace, v3),
                                                      copilot billing notice on ingestion-mint-failure fallback
utils/governance/wrapper-path-choice.ts             — ingestion-first default for copilot at ALL THREE gateway
                                                      defaults: non-TTY fallback, prompt pre-selection, prompt
                                                      abort — THE seam for Decision 3
utils/governance/wrapper-mode.ts                    — SOURCE_TYPE_BY_TOOL.copilot = "copilot_cli",
                                                      buildOtelEnvBlock copilot case,
                                                      copilot-specific billing notice on policy downgrade to gateway
utils/governance/platform-tool-policy.ts            — PlatformToolSlug union + copilot defaults (both true)
utils/governance/telemetry-targets.ts               — SHELL_FUNCTION_TOOLS += copilot (+ config write target if needed)
                                                      NOTE: shell-rc.ts TOOLS must NOT gain copilot (Decision 7)
platform/app/ee/governance/services/platformToolPolicy.service.ts — server-side copilot slug + defaults (admin UI toggle)
platform/app/src/server/.../canonicalisation/extractors/copilot.ts — thin specifics-only extractor, registered after
                                                      GenAIExtractor, primitives from _extraction.ts/_messages.ts
platform/app/src/components/me/tiles/               — copilot assistant tile/icon
specs/ai-governance/cli-wrappers/*.feature          — scenarios for the new tool
```

## Rejected alternatives

- **Path B only first** — leaves the gateway story undecided; half-integrations rot (cursor precedent).
- **`copilot` / `github_copilot` slugs** — confusable with `copilot_studio` now / with future Copilot IDE feeds respectively.
- **hasVk→gateway default for copilot** — silent billing shift off the user's Copilot seat.
- **Always-prompt path choice** — redundant with the existing wrap-path-choice UX.
- **Fully independent extractor** — duplicated semconv logic that drifts.
- **Lifts inside `genAi.ts`** — Copilot specifics leaking into the generic extractor.
- **Anthropic-first gateway impersonation** — per-org branching no other tool has.
- **Per-tool admin provider-type knob** — policy plumbing for a knob nobody will touch.
- **Copilot-config env persistence** — unverified surface, overridable by managed settings.
- **Hard version minimum / hard managed-settings fail** — stricter than every existing tool for no data-integrity gain.
- **v1 events.jsonl harvest / hooks install** — redundant with content-carrying OTel; unversioned format; no tokens in hook payloads.

## Consequences

**Positive.** Highest-adoption assistant covered with the cheapest integration yet (native semconv spans — no log-to-span rebuild, no transcript tailing). Server-side `totals_by_cli` in GitHub's metrics API gives customers an independent cross-check of our numbers.

**Negative.** Ingestion-first introduces the first per-tool default exception in `resolveWrapperPath` — the path-selection mental model gains a branch. Enterprise-managed users may produce zero data after only a warning. captureContent's exact CLI mechanism is unverified until the spike (Decision 5 carries a conditional). Non-BYOK gateway interception is impossible — Path A genuinely changes what Copilot bills, which support must be able to explain.

**Neutral.** Copilot's OTel emits no standalone log records, so the claude-code log pipeline is not exercised. Hooks/transcripts remain available as a future belt-and-braces PR. The `copilot --version` pre-spawn check adds a small per-run spawn cost — cache the result (keyed by binary mtime or per-day) if it proves noticeable. Windows users get no bare-run persistence (the scoped-function path targets zsh/bash/fish only — pre-existing parity with gemini/opencode), and the managed-settings detection paths are OS-specific.

## Open questions

- **Dogfood spike (implementation step 1, owner: implementer):** dump real spans from copilot ≥ 1.0.41 against a local collector; confirm semconv attribute names canonicalize via the existing GenAIExtractor chain pass, confirm the captureContent mechanism (env vs config write) and payload shape/size — including whether content lands on span attributes or span events. Also record copilot's **instrumentation scope name** and decide whether `coding-agent-span-filter.ts` (scope-keyed noise filtering for codex/opencode) needs a copilot entry, and verify the OTLP value for `COPILOT_OTEL_EXPORTER_TYPE`. The spike gates extractor + Decision 5 mechanism details, not the ADR.
- **Gateway model servability (spike step 2, owner: implementer):** verify the gateway's OpenAI-compat surface actually serves a Copilot request naming a Claude-family model against an anthropic-only org (Bifrost translation + model aliases). Preflight's family check passes on either family and cannot validate model-level servability — a green preflight can still 404 at runtime (the Azure api-version failure class). If translation doesn't hold, Decision 4 gains a preflight refinement, not a new provider branch.
- **Copilot metrics-API reconciliation (deferred, not blocking):** whether to surface GitHub's `totals_by_cli` per-user report next to our numbers in analytics.
- **Enterprise managed-settings cooperation (deferred):** longer-term, orgs could point managed settings AT LangWatch (enterprise-pinned collector = our endpoint) instead of fighting the override — a docs/sales play, not code.

## Extension: GitHub Copilot app

Adds the standalone GitHub Copilot app as a tracked surface, on the same `copilot.ts` extractor and `/api/otel` ingest as the CLI. Status: Accepted. Scope: the app; later surfaces are in the Roadmap.

### E1. Capture by direct OTLP export — the same mechanism as the CLI
The app embeds the same OpenTelemetry runtime as the CLI and honors the standard OTLP-endpoint env vars. Setting them makes the app POST one `gen_ai.*` OTLP record per LLM call straight to LangWatch's `/api/otel` — the exact path §Decision already ships for `copilot_cli` Path B. There is no export file, no reader, no tail, no SQLite: capture is the app's own live OTLP push. A single record already carries usage, cost, content, and identity:

- `gen_ai.usage.input/output/cache_read/reasoning_tokens`, `gen_ai.response.model`
- `github.copilot.cost`, `github.copilot.nano_aiu`
- `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`
- `enduser.pseudo.id`, `github.copilot.service_request_id`, `interaction_id`

Enabled by four env vars on the app process:
```
COPILOT_OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=<langwatch>/api/otel
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <ingest key>
COPILOT_OTEL_CAPTURE_CONTENT=true
```
The app appends `/v1/traces` to the endpoint, so it POSTs to `/api/otel/v1/traces`. Content capture is on, protected by the existing ESSENTIAL server-side PII redaction on `/api/otel`. sourceType `copilot_app`.

### E2. Delivery — a user login agent owns the app launch
The auth token can only be supplied by an env var (Copilot exposes no file-based header), and a GUI app launched from the Dock inherits no shell. So a user-level agent (launchd on macOS, systemd `--user` on Linux, Task Scheduler on Windows) owns the app's launch and sets the four vars on its process. It is self-installed when the user connects Copilot (portal action or `langwatch login` detecting the installed app) and removed by `langwatch logout`. The user takes no action and never touches a GUI setting.

### E3. Scope
The app exports to the same `/api/otel` as the CLI Path B but under sourceType `copilot_app`, minted as a distinct ingest key from the CLI's `copilot_cli` key — the two surfaces are separated by source, not by transport.

### Constants
| Name | Value |
|---|---|
| sourceType | `copilot_app` |
| capture | app-native direct OTLP push to `/api/otel/v1/traces` |
| enable vars | `COPILOT_OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `COPILOT_OTEL_CAPTURE_CONTENT` |
| span granularity | one record per LLM call, emitted natively by the app |
| dedup key | `gen_ai.response.id` / `github.copilot.interaction_id` |
| cost attributes | `github.copilot.cost`, `github.copilot.nano_aiu` (raw AI-unit count) |
| host | user login agent (launchd / systemd --user / Task Scheduler) |
| lifecycle | self-installed at connect; removed by `langwatch logout` |

### Invariants
| Invariant | Satisfied by |
|---|---|
| Each call ingested once | native per-call record id; standard `/api/otel` dedup |
| Never mis-attribute content | one native record carries usage + content together; no pairing step exists to get wrong |
| No cross-surface double-capture | app uses its own `copilot_app` ingest key, distinct from the CLI's `copilot_cli` key |
| No scraping of live state | direct OTLP push; never reads the app's SQLite/session files |
| Automatic, no user action | login agent owns the launch and sets the env; no GUI setting |
| Well-behaved agent | one long-lived process that owns the app launch; no per-write respawn |
| One extractor | native `gen_ai.*` + `github.copilot.*` records, canonicalized by `copilot.ts` (extended for `github.copilot.nano_aiu`) |
| Content protected | ESSENTIAL PII redaction on `/api/otel` |
| Fat-payload safe | `capOversizedAttributes` on the span path |

### Consequences
- Prompts, responses, model, full token counts, and cost (`nano_aiu`) stream live and automatically over standard OTLP — the same transport already shipped for the CLI, so the app adds no new capture pipeline.
- Empirically validated on the shipped app (1.0.71): the app's spawned runtime inherits injected env and POSTs authenticated `gen_ai.*` OTLP (`Authorization: Bearer …` → `/v1/traces`, ~180 KB per turn) carrying tokens, `github.copilot.cost`/`nano_aiu`, and full messages.
- The only app-specific work is the login agent that owns the launch; everything downstream (key mint, `/api/otel`, `copilot.ts`) is unchanged.
- The context-source token breakdown (`context_*_tokens`) lives only in the app's private DB, not on the OTLP record; it is out of scope — total tokens and total cost are unaffected.

### Open questions
- Enterprise `managed-settings.json` (GitHub, 2026-07) could later push OTel config file-based, but its auth header is still env-only and its schema is not yet in the shipped build — not a substitute for the login agent, revisit if GitHub documents a file-based header.
- If the `context_*_tokens` breakdown is ever wanted, enrich from `session-store.db` keyed on `service_request_id` — deferred, not blocking.

### Roadmap
- VS Code extension — via `github.copilot.chat.otel.*` settings.
- Enterprise fleet with per-user identity.

## Changelog
- **v7 (2026-08-05, live-wire ruthless review — corrections from a real 1.0.79 capture):** (1) **Token double-count fixed:** copilot's root `invoke_agent` span carries `gen_ai.usage.*` that is the exact rollup of its `chat` children (single turn: chat=15560/153 AND invoke_agent=15560/153, confirmed against copilot's own footer), so every trace folded 2× tokens/cost/cache. The extractor now stamps `langwatch.reserved.skip_token_accumulation` on usage-bearing `invoke_agent` spans — same shape as codex's `handle_responses` marker — with an extractor→fold regression test asserting the trace total. (2) **Scope corrected:** the real wire scope is `github.copilot`, not the v4-recorded `@github/copilot` (kept as a legacy alias in `COPILOT_SCOPES`). (3) **Reasoning tokens:** copilot spells `gen_ai.usage.reasoning.output_tokens`; now mapped to the canonical `gen_ai.usage.reasoning_tokens`. (4) **Seat-bypass wording completed:** the interactive prompt's gateway answer — the route that actually moves spend — now names the shift; the explicit/pinned notices are policy-gated so a run the org downgrades to ingestion isn't falsely warned. (5) **Key-refresh parity:** the per-run scoped-function re-sync now covers every `SHELL_FUNCTION_TOOLS` member (copilot was excluded — bare `copilot` would 401 forever after a key re-mint, the #6202 class).
- **v6 (2026-07-31, superseded-by-#6343 alignment):** main's #6343 made the wrapper **ingestion-first for every tool** and removed the ingestion-mint-failure fallback onto the gateway (an expired session now recovers inline and retries the same path; other mint failures stop the run; a prompt abort cancels the run). This universalizes Decision 3's billing-safety goal, so the copilot-specific mechanics it introduced are gone: `silentDefaultMode`'s copilot carve-out (all three flips) and the seat-bypass suffix on the mint-failure fallback message. Decision 3's surviving copilot-specific contract is the **wording**: every remaining route that puts copilot on the gateway — org policy or an explicit choice — names the Copilot-seat bypass (`copilotSeatBypassSuffix`, applied at the policy-downgrade notice in `wrapper-mode.ts` and the single-allowed-path branch in `wrapper-path-choice.ts`). `specs/ai-governance/cli-wrappers/copilot-path-defaults.feature` reframed accordingly.
- 2026-07-14 — GitHub Copilot app extension (§Extension): capture by direct OTLP export — the app POSTs one `gen_ai.*` record per call straight to `/api/otel`, the same transport shipped for the CLI (Path B), enabled by injecting the OTLP-endpoint + Bearer env at app launch via a user login agent; sourceType `copilot_app`. Empirically validated on the shipped app (1.0.71): injected env reaches the app's spawned runtime, which posts authenticated `gen_ai.*` OTLP carrying tokens, `github.copilot.cost`/`nano_aiu`, and full messages. Supersedes two earlier drafts — the `session-store.db` + `events.jsonl` scrape-and-pair design, and the native file-exporter + tail design — both dropped: no file, no tail, no SQLite. Accepted, PR #5784.
- 2026-07-10 — CLI integration (§Decision 1–10): both paths, ingestion-first default, sourceType `copilot_cli`, `copilot.ts` extractor. Accepted, shipped in PR #5605.
- **v5 (2026-07-10, implementation review pass):** ruthless review of the branch found one blocker + refinements, all folded in. (1) **Blocker:** a previously persisted Path-B rc function defeated the content-capture opt-out AND could resurrect a stale (rotated) ingest token on ingestion runs — its env-prefix applies at invocation, after the wrapper's exports. `unset -f` now runs in BOTH modes (the rc file is never touched; bare runs keep capturing). (2) Silent-default runs no longer pin `tool_mode` — `resolveWrapperMode` persists the pin only on the legacy no-forced-mode derivation; explicit prompt answers persist upstream, so an aborted prompt or CI run can't suppress the path prompt forever. (3) Copilot's gateway env now `clears` the full Path B telemetry block (derived from `telemetryEnvVarNames("copilot")`) so hand-exported OTel env can't double-trace. (4) The extractor's provenance gate dropped bare `enduser.pseudo.id` (standard semconv — consuming it would rename foreign tenants' attributes); provenance = `@github/copilot` scope or a `github.copilot.*` attribute.
- **v4 (2026-07-10, implementation spike resolutions — binary sweep of copilot 1.0.69):** (1) Content capture is the standard env var `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` — Decision 5's degradation ladder collapses to its best branch (no config write exists or is needed); an explicit parent-env `false` is respected with a tokens-only notice, and logout strip symmetry comes free via `telemetryEnvVarNames()`. Content rides `gen_ai.input/output.messages` span attributes. (2) `COPILOT_OTEL_EXPORTER_TYPE` values are `otlp-http` (default) / `file` — pinned to `otlp-http`. (3) Path A base URL must include `/v1` (the binary's own local-provider example is `localhost:11434/v1`) — same convention as opencode. (4) Decision 8 amendment: device-level managed settings live at `/Library/Application Support/GitHubCopilot/managed-settings.json` (macOS, plus MDM domain `com.github.copilot`) and `/etc/github-copilot/policy.d/*.json` (Linux), BUT there is also a server layer fetched at runtime from GitHub's `/copilot_internal/managed_settings` with the user's auth — not preflightable from disk, so detect+warn covers the device layer only. (5) Instrumentation scope is `@github/copilot`; no `coding-agent-span-filter` entry needed (all spans are GenAI-shaped). Extras verified on the wire: `enduser.pseudo.id`, `github.copilot.cost` (premium-request units, NOT dollars — kept out of langwatch cost fields), `github.copilot.total_premium_requests`.
- **v3 (2026-07-10, adversarial consistency review):** verified v2's blocker claims against the actual code (they held) and found four new gaps. (1) **Double-trace hole** — a persisted Path-B rc function survives into gateway runs via the `-i` login-shell spawn and re-injects OTel vars at invocation time; gateway reapply now prepends `unset -f <tool>`; pre-existing for gemini/opencode, fixed generically in the same PR. (2) `resolveWrapperPath` has **three** gateway defaults, not two — the prompt-abort path (Ctrl-C) also defaulted copilot into gateway billing; all three now flip to ingestion. (3) The ingestion-mint-failure fallback in `runWrapped` is another unlabeled billing shift — gets the copilot billing notice. (4) An inherited `COPILOT_OTEL_EXPORTER_TYPE=file` (ccusage setup) silently kills Path B — the env block now sets the exporter type explicitly. Also corrected the `service.name` constant's purpose (extraction gates on `gen_ai.*`, not service.name), added the span-filter scope question + exporter-type value to the spike, and noted version-check latency + Windows persistence parity. No locked fork reopened.
- **v2 (2026-07-10, red-team pass):** devils-advocate found the draft's two blockers shared one root cause — wrong code seams. (1) Ingestion-first default moved from `resolveWrapperMode` (dead branch — `resolveWrapperPath` always forces a mode) to `resolveWrapperPath`; test anchor re-pointed to avoid a green-but-lying test. (2) Impl map's `shell-rc.ts TOOLS += copilot` removed — that's the global gateway export block and would have persisted BYOK billing into every shell; copilot goes only into `telemetry-targets.ts SHELL_FUNCTION_TOOLS`. Also folded: mode-independent pre-spawn warnings (preflight only runs on gateway; copilot defaults to ingestion), copilot-specific billing notice on policy downgrade, extractor reframed as thin chain-member after GenAIExtractor (chain already canonicalizes semconv — primitives live in `_extraction.ts`, not genAi "shared functions"), fat-payload invariant re-pointed from claude's log-path guards to `capOversizedAttributes` span-path + events/accumulation test cases, captureContent degradation ladder locked (env → config write → loud tokens-only warning), server-side PlatformToolPolicy slug + gateway model-servability spike added. No locked fork reopened — every fix corrects wiring facts, not choices.
- **v1 (2026-07-10):** Initial draft. Round 1 locked: framing (full integration, governance expansion, data-pipeline blast radius, four constraints). Round 2 locked: `copilot_cli` slug, ingestion-first default, shell-function persistence; extractor fork re-asked after a worked example — user chose the delegating `copilot.ts` middle ground over pure-reuse and pure-independent. Round 3 locked: managed-settings detect+warn, version preflight warn, hooks/transcripts deferred, gateway impersonates OpenAI always.
