# ADR-061: Langy turns export twice — the customer's trace, and ours

**Date:** 2026-07-22

**Status:** Accepted (design; implementation starting)

**Builds on:** the existing relay dual-export lane (`services/langyagent/adapters/otelrelay`, `otel/angelinajolie.go` — the content-stripped operational copy), ADR-043/ADR-053 (egress), ADR-055 (canonical OTLP pipelines), `specs/langy/langy-otel-tracing.feature` (amended by this ADR).

## Context

A Langy turn already exports its trace to the **customer's project** over three
legs: worker spans through the manager's relay (session-key auth, fail-closed
resource-attribute allowlist), the platform-owned `langy.turn` root span, and
gen_ai spans — including full prompt/completion content — emitted directly by
the AI gateway's `customertracebridge`.

A **second lane also already exists**: the relay ships a content-stripped copy
of worker spans to LangWatch's observability collector — a blank-tree allowlist
rebuild (`InternalCopy`) carrying only timings, token usage, status, closed-
vocabulary enums and a manager-trusted model string, on a bounded queue that is
fully detached from the customer path. The shipped spec promised that LangWatch
cannot see customer prompts, completions or tool output through this lane.

LangWatch needs to run Langy as a product: watch real turns in its own
production Langy project with the same tools customers use. Structural spans in
Grafana cannot answer prompt-level quality questions. This ADR retargets and
extends the second lane — and **changes the content posture deliberately**.

## Decision

### 1. The second lane targets the prod Langy project, from the relay

The manager's existing fan-out gains LangWatch's production Langy project as a
destination: `POST <endpoint>/api/otel/v1/traces` with a **static project API
key held by the Go manager only** — product configuration
(`LANGY_MIRROR_TRACE_ENDPOINT` / `LANGY_MIRROR_TRACE_KEY`), never `OTEL_*`
(that namespace configures LangWatch telemetry only), and never on a TS
platform process (the platform self-ingest guard is untouched). The lane keeps
everything that made the collector copy safe: the bounded queue, drop-on-full
counter, and the invariant that a mirror-lane failure is invisible to the
worker and to the customer lane.

### 2. Three tiers, all fail-closed allowlists

- **content** — the structural allowlist **plus** an explicit content-key
  allowlist (`gen_ai.input.messages`, `gen_ai.output.messages`, the tool
  payload keys). Never "copy minus a denylist": an attribute nobody listed
  does not travel, exactly as `InternalCopy` already guarantees.
- **structural** — `InternalCopy` verbatim, as shipped.
- **skip** — no mirror copy at all.

### 3. Posture: content by default, per-customer restriction

The maintainer's explicit call: the mirror is **content-tier by default**, and
specific customers are restricted to structural or skip. v1 ships always-on
content with the policy seam in place: the control plane resolves the tier per
organization and threads it through the **credentials envelope** into the
worker signature (the `EgressAllowlist` precedent — a policy change recycles
the worker), so the relay only ever reads the envelope. The per-org store
arrives as a follow-up: a Postgres-backed policy row cached in Redis, the same
shape as the data-privacy policy service. Until it lands, the resolver returns
the deployment default.

Two hard rules regardless of tier:

- **Self-skip:** a turn whose customer project *is* the prod Langy project
  never mirrors — the one genuine self-ingest loop, excluded by construction.
- **This reverses a shipped promise.** The prior spec language ("LangWatch
  cannot see the customer's prompts…") described the structural tier and is
  now scoped to it. The customer-facing consequence — what the platform may
  observe by default — is a contract/DPA matter: legal review of the
  customer-facing terms is a ship-gate for enabling the default in production,
  tracked outside this repo.

### 4. Full fidelity: the gateway leg mirrors too

The gateway's `customertracebridge` emitter gains the mirror as a second
destination, governed by the same envelope-resolved tier, so prompt/completion
bodies reach the mirror only when the tier says content. This is the one part
of the copy the relay cannot synthesize — the gen_ai spans never transit it.

### 5. Metering and attribution

The mirror ingests through the normal pipeline (ADR-055): the prod Langy
project is an internal organization whose billing is an operational matter, not
a code path. Every mirror flow carries the source tenant as a resource
attribute (ADR-053 Track A attribution), so volume per customer is measurable
and the future per-org policy has an audit trail.

## Consequences

- `specs/langy/langy-otel-tracing.feature`'s second-lane section is rewritten
  to state the tiered rule; the structural-tier guarantees keep their
  scenarios, scoped to that tier.
- The relay's `dual_export_test.go` suite grows tier cases + the self-skip
  guard; the gateway emitter gains mirror tests.
- Key rotation for the static mirror key follows ordinary project API key
  rotation, mounted via the langyagent chart secret.
- Self-hosted installs: the mirror is pointless without a LangWatch-owned
  destination; the config simply stays unset and the lane is dormant.

## Open questions

- The content-key allowlist's evolution — who owns adding a new content
  attribute (it must be a deliberate act, per the fail-closed doctrine).
- Whether the per-org policy surface, when it lands, is customer-visible
  (data-privacy disposition) or ops-only — deferred with the store itself.
