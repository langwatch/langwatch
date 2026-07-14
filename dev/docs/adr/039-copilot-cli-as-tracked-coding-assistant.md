# ADR-039: GitHub Copilot as a tracked coding assistant — CLI + IDE + app, on the unified substrate

**Date:** 2026-07-10 (CLI, Accepted) · extended 2026-07-14 (multi-surface, Proposed)

**Status:** Accepted (CLI / §1–§4) · Proposed (multi-surface extension / §Extension)

> One-line: `langwatch copilot` becomes a **first-class wrapped tool** with **both paths** — gateway via **BYOK env vars** and direct OTLP via **native OTel** — defaulting to **ingestion** (sourceType **`copilot_cli`**), extracted by a **`copilot.ts` extractor that delegates standard GenAI-semconv parsing to the shared genAi reader**. **Extended (2026-07-14):** every other Copilot surface (**standalone app**, **VS Code extension**) folds onto the same `copilot.ts` extractor via **two ingestion lanes** — live OTLP and a `~/.copilot` file reader.

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

1. **Full tool integration, both paths.** `langwatch copilot` registers alongside the other four in `typescript-sdk/src/cli/index.ts` → `wrap.ts` → `runWrapped("copilot")`. Rejects the Path-B-only scope: both paths are cheap given the research, and a half-integration (cursor's hidden gateway-only command) demonstrably rots.

2. **sourceType is `copilot_cli`.** `copilot_studio` already exists (ADR-018, Microsoft Copilot Studio S3 audit feeds); a bare `copilot` slug would be confusable in the API-keys page and analytics filters, and `github_copilot` would collide again if Copilot IDE telemetry is ever ingested. The command name stays `copilot`; slug ≠ command follows the `claude` → `claude_code` precedent. The mint endpoint takes free-form `source_type` (`auth-cli.ts:1300`) — no server enum migration.

3. **Ingestion-first default — a deliberate deviation from the hasVk→gateway heuristic.** When no mode is pinned, copilot defaults to `ingestion` even when a VK is present. Why: Path A switches Copilot into BYOK mode, silently moving spend from the user's already-paid Copilot seat to the org's provider API keys. For claude/codex the base-URL swap is billing-neutral (API key either way); for copilot it is not. **Seam correction (v2):** the production default is selected in `resolveWrapperPath` (`wrapper-path-choice.ts`), which always passes a `forcedMode` into `resolveWrapperMode` — a copilot exception written only into `resolveWrapperMode`'s fallback would be dead code. **Complete gateway-default inventory (v3):** `resolveWrapperPath` defaults to gateway in **three** places, and all three flip to `ingestion` for copilot: the non-TTY/CI fallback (`wrapper-path-choice.ts:255`), the interactive prompt's pre-selection (`initial: 0`, line 272), and the **prompt-abort path** (Ctrl-C, line 279 — v2 missed this one; an aborted prompt must not silently opt a copilot user into gateway billing). The billing concern also applies to two later fallbacks: the policy-downgrade (`wrapper-mode.ts:188`) **and the ingestion-mint-failure fallback in `runWrapped` (`wrapper.ts:471-489`, e.g. control plane unreachable)** — both route copilot onto the gateway mid-run, and both notices must state that spend moves off the user's Copilot seat; the generic "routing/falling back to the gateway" lines are insufficient for copilot. Rejects "same as other tools" (surprise cost shift) and "always prompt" (the wrap-path-choice UX already prompts when both paths are allowed and no preference exists; this decision only changes the defaults inside that flow).

4. **Path A impersonates OpenAI, always.** `envForTool("copilot")` sets `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_BASE_URL=<gateway>`, `COPILOT_PROVIDER_API_KEY=<vk>`. One code path; the gateway's OpenAI-compatible surface routes to any configured upstream, with model aliases handling Claude-family names. Rejects per-org anthropic/openai branching (a special case no other tool has) and a per-tool admin knob (schema + UI for a setting nobody will touch). `TOOL_PROVIDER_FAMILIES.copilot = ["openai", "anthropic"]` so preflight accepts either upstream being configured.

5. **Path B env block mirrors claude's capture-everything policy, with a locked degradation ladder for content capture.** `buildOtelEnvBlock("copilot")` sets `COPILOT_OTEL_ENABLED=true`, exporters `otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, endpoint + Bearer header, `OTEL_RESOURCE_ATTRIBUTES=service.name=copilot-cli`. Content capture (`captureContent`) is enabled by default per the capture-everything constraint. The exact mechanism (env var vs config write) is spike-verified, but the **degradation is locked now**: attempt env var → fall back to an idempotent config write with opencode-flag semantics (never overwrite an explicit user `false`; register the write in `telemetry-targets.ts`) → if neither works, print a one-line "content capture unavailable — traces will carry tokens only" warning. Never silently run tokens-only. If the mechanism is an env var it joins `buildOtelEnvBlock` and is therefore covered by `telemetryEnvVarNames()` for logout strip symmetry automatically. **Exporter-type defense (v3):** `buildOtelEnvBlock("copilot")` must also explicitly set `COPILOT_OTEL_EXPORTER_TYPE` to the OTLP value (exact string spike-verified) — a user who previously configured the file exporter (`COPILOT_OTEL_EXPORTER_TYPE=file`, the ccusage setup) would otherwise inherit it from the parent env and silently redirect all telemetry to a local file: Path B alive-but-dead, the "copilot shows nothing" class. Set-explicitly is chosen over a clears entry because ingestion-mode results carry no `clears` mechanism today (`clears` only propagates on gateway returns) and overriding the key is strictly simpler than building one.

6. **Extractor: `copilot.ts`, thin and specifics-only, riding the extractor chain.** The canonicalisation pipeline runs extractors as a **chain** — every extractor applies to every span — and `GenAIExtractor` (registered at chain position 2, gated on `gen_ai.*` presence) **already canonicalizes Copilot's standard semconv attributes with zero new code**. So `copilot.ts` is a dedicated, thin extractor registered **after** `GenAIExtractor`, reading only the Copilot specifics: premium-request consumption, `github.copilot.*` repo/org attrs, `enduser.pseudo.id`, content payloads. Where it needs standard parsing primitives it imports them from the shared `_extraction.ts`/`_messages.ts` modules (the same primitives `genAi.ts` consumes) — never a re-implementation. It must not re-`take()` attributes GenAIExtractor already consumed. This preserves the locked fork's intent (dedicated named file, no duplicated logic) with even less code than the draft assumed. Rejects a fully independent extractor (duplicated semconv logic that drifts) and rejects folding lifts into `genAi.ts` itself (Copilot specifics leaking into the generic path).

7. **Persistence for bare `copilot` runs: scoped shell function — and NOT the global gateway export block.** Copilot joins `SHELL_FUNCTION_TOOLS` in `telemetry-targets.ts` (alongside `gemini`, `opencode`) — a marker-bracketed rc function whose install path (`shell-rc.ts` scoped-function persist) is generic and carries tool-specific vars like `COPILOT_OTEL_ENABLED` without changes (verified: gemini's `GEMINI_TELEMETRY_*` vars already ride it). **Copilot must NOT be added to `shell-rc.ts`'s `TOOLS` const** — that list feeds `buildExportBlock`, the global gateway export block, and adding copilot there would persist `COPILOT_PROVIDER_*` BYOK vars into every shell, forcing every bare `copilot` into gateway billing — the exact shift Decision 3 forbids. Rejects writing Copilot's own config (env-injection surface unverified; managed settings can override it) and wrapper-only capture (loses all habit-driven bare runs).

8. **Managed-settings conflict: detect + warn, continue — mode-independent.** The wrapper checks the OS-specific managed-settings locations; when an enterprise OTel pin exists, print one stderr line ("enterprise policy routes copilot telemetry elsewhere; LangWatch capture may be incomplete") and proceed. **Seam note (v2):** `preflightWrapper` only runs on the gateway branch, and copilot's default is ingestion — so this check (and Decision 9's) runs as a copilot-specific pre-spawn step in `runWrapped`, independent of the resolved mode. Rejects hard-fail (blocks users who still want gateway mode) and ignore (the "copilot shows nothing" silent-failure class).

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
| No double trace | A run never has gateway capture AND OTel emission for the same calls | mode exclusivity in `resolveWrapperMode` is **not sufficient** (v3): a previously persisted Path-B rc function survives into gateway runs — the wrapper spawns via `$SHELL -i -c '…; copilot "$@"'`, the sourced rc defines `copilot() { OTEL vars… command copilot }`, and the function's env-prefix applies at invocation, AFTER the wrapper's reapply exports → gateway capture + OTel emission. Gateway-mode reapply must prepend `unset -f copilot 2>/dev/null` (kills the function, keeps aliases). Test anchor: gateway-mode spawn with a persisted rc function emits no OTLP. NOTE: this hole is pre-existing for gemini/opencode — fix generically for all `SHELL_FUNCTION_TOOLS` in the same PR (sweep item) |
| Logout symmetry | Every persisted artifact is discoverable + removable | shell function via existing `toolMarkers("copilot")`; any captureContent config write registered in `scanTelemetryTargets()`; env-var strips via `telemetryEnvVarNames("copilot")` — extend `logout.feature` |
| Billing neutrality by default | Default path never silently moves spend off the user's Copilot seat | ingestion-first default in **`resolveWrapperPath`** (Decision 3) — unit test on `resolveWrapperPath`: `hasVk=true, no pin, non-TTY → ingestion` for copilot only (a `resolveWrapperMode`-only test would pass while production does the opposite — the seam matters) |
| Ingestion is wired, not fallthrough | `SOURCE_TYPE_BY_TOOL.copilot` exists — a missing entry makes `resolveWrapperMode` silently fall back to gateway, reintroducing the billing shift | unit test: copilot ingestion mode mints a `copilot_cli` key, never returns gateway shape |
| TenantId scoping | Copilot spans land project-scoped like all ingest | existing ingest-key → hidden-governance-project binding (ADR-018); no new write path |
| Fat-payload safety | captureContent bodies cannot OOM the fold | `capOversizedAttributes` (span path: walks `span.attributes` AND `span.events[].attributes`, 256KB/value, unconditional on recordSpan) — NOT the claude raw-bodies guards, which are log-path only. Matrix test: oversized content on span **events**, plus a many-span accumulation case (the CH-merge OOM vector is fold accumulation, not one big value) |
| No attribute spoofing | `langwatch.origin.*` / `langwatch.ingestion_source.*` rejected from user OTLP | existing receiver edge stamping (ADR-018), unchanged |

## Schema

No Prisma migration. `IngestionSource.sourceType` and the mint endpoint accept free-form strings; `copilot_cli` is a new value, not a new column. ClickHouse untouched — spans ride the existing `recorded_spans` pipeline.

Touched surfaces (implementation map, not schema):

```
typescript-sdk/src/cli/index.ts                     — register `copilot` command
typescript-sdk/src/cli/commands/wrap.ts             — wrapCopilot shim
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
langwatch/src/server/.../PlatformToolPolicyService  — server-side copilot slug + defaults (admin UI toggle)
langwatch/src/.../canonicalisation/extractors/copilot.ts — thin specifics-only extractor, registered after
                                                      GenAIExtractor, primitives from _extraction.ts/_messages.ts
langwatch/src/components/me/tiles/                  — copilot assistant tile/icon
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

## Extension: capture the GitHub Copilot app (stacked on PR #5605 — Proposed, 2026-07-14)

The CLI decisions above (§1–§4) are Accepted and shipped. This extension adds the **standalone GitHub Copilot app** ("Copilot IDE") as a tracked surface. Scope was narrowed during `/parc-ferme` (2026-07-14): **v1 is the app only** — VS Code and enterprise named-per-user are deferred (see Open questions). Forces: PR #5784 open and stacked, investigation loaded, app just GA'd. Blast radius: data-pipeline + auth/secret (mandatory red-team). Confirmed constraints (excluded from forks): one `copilot.ts` extractor / one substrate (ADR-018); reuse the `codex-rollout-otlp.ts` reader pattern; capture-everything default (protected by ESSENTIAL server-side PII redaction); no new server ingest endpoint (existing `/api/otel` + personal ingest key). Tracked: issue #5783.

### E1. The architecture — one canonical shape, two lanes (the app uses Lane 2)
Every Copilot surface converges on the **same `copilot.ts` extractor** on the unified substrate, fed by two lanes:
- **Lane 1 — live OTLP:** env-flip (CLI, §1–§4) or managed-pin (fleet, deferred) emits `gen_ai.*` to `/api/otel`.
- **Lane 2 — file reader (this extension):** reads the tool's own files and re-emits per-turn OTLP, reusing `codex-rollout-otlp.ts`.

### E2. The app is Lane 2, captured by a codex-style wrapper (locked)
The GitHub Copilot app is a native binary that spawns the `copilot` CLI over stdio (**not** a sealed VM — verified 2026-07-14) and writes host-readable files to `~/.copilot`. Capture mirrors codex exactly: a new **`langwatch copilot-app`** command **launches the app binary**, runs the codex-style streamer against `~/.copilot` **for the app's lifetime** (poll each completed turn → emit OTLP; final sweep on quit), and exits when the app exits. **No persistent daemon** — the streamer dies with the wrapped app, honoring the opik-cipx incident lesson (their launchd/systemd supervisor tripped SentinelOne and crashed machines; they removed it permanently).

### E3. Hybrid file source (locked)
The reader reads the app's **native files as the primary source** — `session-store.db.assistant_usage_events` (per-turn `input/output/cache_read/cache_write/reasoning_tokens`, `model`, `nano_aiu` cost, latency, `finish_reason`, and `context_*_tokens` **content-source token breakdown**) + `session-state/*/events.jsonl` (prompts, responses, tool calls) — because they are **always written with zero user setup** and carry the richest data. When the app's **OTLP-file-exporter output is present** (user has OTel file-export configured), the reader prefers those standard `gen_ai.*` spans for the core and **enriches** them with the native cost/context fields. Native primary matches the codex precedent (codex reads its own native rollup) and the zero-setup wedge; OTLP enrichment buys format-stability when available.

### E4. sourceType + shared abstractions (locked)
- **sourceType `copilot_app`** (distinct from `copilot_cli`). The **shared `~/.copilot`** (CLI + app both write it) is disambiguated by the app's own session provenance and a **deterministic span id per turn** (codex pattern) so overlapping reads dedup server-side.
- **One file-reader abstraction** serving `codex` + `copilot_app` (+ future). Do not fork the reader.

### E5. Extension constants
| Name | Value | Purpose |
|---|---|---|
| sourceType | `copilot_app` | ingest provenance for the app |
| command | `langwatch copilot-app` | launches the app + runs the streamer |
| primary source | `~/.copilot/session-store.db` + `session-state/*/events.jsonl` | always-on, richest |
| enrichment source | app OTLP-file-exporter output (when present) | stable `gen_ai.*` core |
| poll cadence | reuse codex `CODEX_IO_POLL_MS` (2.5s) | per-turn streaming |
| cost field | `nano_aiu` (÷ 1e9 = AI Units; NOT dollars) | kept off langwatch dollar-cost, like `github.copilot.cost` |

### E6. Extension invariants
| Invariant | Meaning | Satisfied by |
|---|---|---|
| No double-capture | app + CLI share `~/.copilot`; a turn is ingested once | deterministic per-turn span id (codex pattern) → server dedup; `copilot_app` reader only claims app sessions |
| No persistent daemon | nothing survives the wrapped app | streamer lifetime == app process lifetime (E2), like codex |
| One extractor | app spans canonicalize via `copilot.ts` | reader emits `gen_ai.*` + `github.copilot.*`; extractor extended for `nano_aiu` + `context_*_tokens` |
| Content protected | prompts captured, PII-redacted before storage | existing ESSENTIAL redaction on `/api/otel` (unchanged) |
| Fat-payload safe | large turns can't OOM the fold | existing `capOversizedAttributes` on the span path (unchanged) |

### E7. Rejected alternatives (extension)
- **OTLP-file-exporter as the *only* source** — needs the app configured for OTel file-export (setup friction) and loses `nano_aiu` cost + content-source breakdown. Kept as *enrichment* only.
- **Background watcher / login-item daemon** — the persistent-supervisor pattern behavioral EDR flags; the opik-cipx incident is the cautionary tale. Rejected.
- **Piggyback on the CLI wrapper** — only fires if the user also runs `langwatch copilot`; misses pure-app users.
- **VS Code token-in-URL in v1** — dissolved: v1 is app-only, so the GUI-header problem doesn't arise yet. Deferred whole.
- **Named per-user identity-link / metrics / content-source-cost feature in v1** — widens scope past the wedge. Deferred (data is *captured* where free; the *feature* is fast-follow).

### E8. Consequences (extension)
- **Positive:** the app is the easiest Copilot surface (host-readable files, no auth-header problem, no sandbox); reuses the codex reader wholesale; captures exact cost (`nano_aiu`) + the content-source token breakdown natively (the opik-cipx differentiator, free).
- **Negative:** **Dock-launched app is not captured** — only via `langwatch copilot-app` (same class as bare `copilot` vs `langwatch copilot`; no rc-function equivalent for a GUI). Native-file parsing is bespoke and can churn with GitHub app updates — mitigated by pinning stable fields + a versioned parser + OTLP enrichment when present.
- **Neutral:** the streamer is real-time-ish (2.5s poll), not push; acceptable for governance.

### E9. Open questions (extension — deferred, not blocking)
- **Dock-launch capture:** a one-shot `langwatch copilot-app sync` (read recent `~/.copilot` sessions after the fact) to catch sessions not launched via the wrapper. Owner: implementer, fast-follow.
- **VS Code extension:** Lane 1 via `github.copilot.chat.otel.*` + a token-in-URL receiver route (headers aren't a user settings key). Own `/parc-ferme`.
- **Enterprise fleet + named per-user:** managed-settings `telemetry` block + the hash(`enduser.pseudo.id`)→user identity-link (shared with pull connectors). Own decision.
- **Metrics + content-source-cost feature:** `copilot_chat.*` metrics and surfacing the `context_*_tokens` breakdown as cost attribution. Phase 2.

## Revisions

- **v7 (2026-07-14, `/parc-ferme` — extension forks locked):** the §Extension went from framing to locked decisions. Scope **narrowed to the GitHub Copilot app only** (user: "focus only on github app") — VS Code/token-in-URL **dissolved** to a deferred open question. Locked: (E2) codex-style wrapper `langwatch copilot-app` — launch the app, stream `~/.copilot` for its lifetime, no daemon; (E3) **hybrid** file source — native `session-store.db` + `events.jsonl` primary, OTLP-file-export as enrichment; (E4) sourceType `copilot_app`, one shared file-reader, deterministic per-turn span-id dedup for the shared `~/.copilot`; (E9) VS Code, enterprise identity-link, metrics + content-source-cost feature all deferred. Four framing constraints confirmed (one extractor/substrate, reuse codex reader, capture-everything default, no new endpoint). Status Proposed pending red-team + lock.
- **v6 (2026-07-14, multi-surface extension — stacked on PR #5605):** broadened ADR-039 from CLI-only to **all Copilot surfaces** rather than opening a new ADR. Added the §Extension section: two-lane capture model (live OTLP + `~/.copilot` file reader, codex pattern), empirically-verified app/VS-Code surface facts, the `copilot_cli`/`copilot_app`/`copilot_vscode` taxonomy, shared file-reader + IDE-settings-writer abstractions, and the open forks for `/parc-ferme`. CLI decisions §1–§4 unchanged (Accepted); the extension is Proposed. Tracked in #5783 / #5784.
- **v5 (2026-07-10, implementation review pass):** ruthless review of the branch found one blocker + refinements, all folded in. (1) **Blocker:** a previously persisted Path-B rc function defeated the content-capture opt-out AND could resurrect a stale (rotated) ingest token on ingestion runs — its env-prefix applies at invocation, after the wrapper's exports. `unset -f` now runs in BOTH modes (the rc file is never touched; bare runs keep capturing). (2) Silent-default runs no longer pin `tool_mode` — `resolveWrapperMode` persists the pin only on the legacy no-forced-mode derivation; explicit prompt answers persist upstream, so an aborted prompt or CI run can't suppress the path prompt forever. (3) Copilot's gateway env now `clears` the full Path B telemetry block (derived from `telemetryEnvVarNames("copilot")`) so hand-exported OTel env can't double-trace. (4) The extractor's provenance gate dropped bare `enduser.pseudo.id` (standard semconv — consuming it would rename foreign tenants' attributes); provenance = `@github/copilot` scope or a `github.copilot.*` attribute.
- **v4 (2026-07-10, implementation spike resolutions — binary sweep of copilot 1.0.69):** (1) Content capture is the standard env var `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` — Decision 5's degradation ladder collapses to its best branch (no config write exists or is needed); an explicit parent-env `false` is respected with a tokens-only notice, and logout strip symmetry comes free via `telemetryEnvVarNames()`. Content rides `gen_ai.input/output.messages` span attributes. (2) `COPILOT_OTEL_EXPORTER_TYPE` values are `otlp-http` (default) / `file` — pinned to `otlp-http`. (3) Path A base URL must include `/v1` (the binary's own local-provider example is `localhost:11434/v1`) — same convention as opencode. (4) Decision 8 amendment: device-level managed settings live at `/Library/Application Support/GitHubCopilot/managed-settings.json` (macOS, plus MDM domain `com.github.copilot`) and `/etc/github-copilot/policy.d/*.json` (Linux), BUT there is also a server layer fetched at runtime from GitHub's `/copilot_internal/managed_settings` with the user's auth — not preflightable from disk, so detect+warn covers the device layer only. (5) Instrumentation scope is `@github/copilot`; no `coding-agent-span-filter` entry needed (all spans are GenAI-shaped). Extras verified on the wire: `enduser.pseudo.id`, `github.copilot.cost` (premium-request units, NOT dollars — kept out of langwatch cost fields), `github.copilot.total_premium_requests`.
- **v3 (2026-07-10, adversarial consistency review):** verified v2's blocker claims against the actual code (they held) and found four new gaps. (1) **Double-trace hole** — a persisted Path-B rc function survives into gateway runs via the `-i` login-shell spawn and re-injects OTel vars at invocation time; gateway reapply now prepends `unset -f <tool>`; pre-existing for gemini/opencode, fixed generically in the same PR. (2) `resolveWrapperPath` has **three** gateway defaults, not two — the prompt-abort path (Ctrl-C) also defaulted copilot into gateway billing; all three now flip to ingestion. (3) The ingestion-mint-failure fallback in `runWrapped` is another unlabeled billing shift — gets the copilot billing notice. (4) An inherited `COPILOT_OTEL_EXPORTER_TYPE=file` (ccusage setup) silently kills Path B — the env block now sets the exporter type explicitly. Also corrected the `service.name` constant's purpose (extraction gates on `gen_ai.*`, not service.name), added the span-filter scope question + exporter-type value to the spike, and noted version-check latency + Windows persistence parity. No locked fork reopened.
- **v2 (2026-07-10, red-team pass):** devils-advocate found the draft's two blockers shared one root cause — wrong code seams. (1) Ingestion-first default moved from `resolveWrapperMode` (dead branch — `resolveWrapperPath` always forces a mode) to `resolveWrapperPath`; test anchor re-pointed to avoid a green-but-lying test. (2) Impl map's `shell-rc.ts TOOLS += copilot` removed — that's the global gateway export block and would have persisted BYOK billing into every shell; copilot goes only into `telemetry-targets.ts SHELL_FUNCTION_TOOLS`. Also folded: mode-independent pre-spawn warnings (preflight only runs on gateway; copilot defaults to ingestion), copilot-specific billing notice on policy downgrade, extractor reframed as thin chain-member after GenAIExtractor (chain already canonicalizes semconv — primitives live in `_extraction.ts`, not genAi "shared functions"), fat-payload invariant re-pointed from claude's log-path guards to `capOversizedAttributes` span-path + events/accumulation test cases, captureContent degradation ladder locked (env → config write → loud tokens-only warning), server-side PlatformToolPolicy slug + gateway model-servability spike added. No locked fork reopened — every fix corrects wiring facts, not choices.
- **v1 (2026-07-10):** Initial draft. Round 1 locked: framing (full integration, governance expansion, data-pipeline blast radius, four constraints). Round 2 locked: `copilot_cli` slug, ingestion-first default, shell-function persistence; extractor fork re-asked after a worked example — user chose the delegating `copilot.ts` middle ground over pure-reuse and pure-independent. Round 3 locked: managed-settings detect+warn, version preflight warn, hooks/transcripts deferred, gateway impersonates OpenAI always.
