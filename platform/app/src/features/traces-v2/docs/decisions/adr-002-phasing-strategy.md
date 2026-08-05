# ADR-002: Phasing Strategy — Foundation First, Differentiators Loose

Status: ACCEPTED
Date: 2026-04-22
Relates to: Design Doc (trace-v2.md), `specs/traces-v2/`

## Context

The /autoplan review flagged a strategic concern: the trace-v2 foundation (table, drawer, visualizations, search, peek, live tail, multiplayer presence) was being specced in detail while the features that differentiate LangWatch from competitors had no specs at all:

- **AI diagnosis** ("What went wrong?" button) — Phase 4+ in design doc
- **AI-generated views** (natural language -> lens config) — Phase 4+
- **Simulation diff** (expected vs actual comparison) — Phase 4+
- **Frustration detection** (sentiment analysis on conversations) — Phase 4+
- **Custom/saved views** — Phase 2 (Lens Engine)

The concern: shipping a beautiful commodity viewer while competitors ship intelligence features.

**Update (2026-04-23):** Custom/saved views were elevated from Phase 5 to Phase 2. The lens engine is now the immediate next phase after foundation, ahead of intelligence features. See the CEO Plan (2026-04-23) for the updated phasing rationale.

## Decision

**Keep differentiator specs intentionally loose until the core UX is nailed.**

The foundation specs in `specs/traces-v2/` define the surface area that intelligence features will plug into. Writing detailed specs for Phase 3-5 features now would be premature because:

1. **The foundation shapes the differentiators.** How AI diagnosis presents results depends on the drawer's tab model, the visualization's zoom behavior, and the span selection UX. These were redesigned significantly during this session (indicator bar → tab model, tree/waterfall/flame → waterfall/flame/span list). If we'd spec'd "What went wrong?" against the old drawer model, we'd be rewriting it now.

2. **Intelligence features need user feedback on the foundation.** The right AI diagnosis UX depends on watching users triage errors in the real product. Do they start from the error preset? The search bar? Live tail? The answer changes what "one click diagnosis" means. We can't know until people use the foundation.

3. **Simulations need the trace viewer to exist first.** Simulation diff compares two traces side by side. The trace viewer defines what "viewing a trace" means. The diff feature is a composition of the viewer, not a separate product. Spec it after the viewer ships.

4. **Loose specs prevent premature commitment.** The design doc describes the intelligence features at the right level of detail for their current stage: what problem they solve, what the interaction model might be, what data they need. Detailed specs would lock in UI decisions that should stay fluid.

## What "Loose" Means

The design doc (trace-v2.md) contains:
- Problem statements for each Phase 3-5 feature
- Interaction sketches (e.g., "one click → 3-sentence diagnosis")
- Data requirements (e.g., "needs access to trace + simulation baseline")
- Fallback behavior (e.g., "when AI diagnosis times out, show raw trace link")
- Success criteria (e.g., ">70% of diagnoses are actionable")

This is sufficient for architectural planning (ensuring the foundation supports these features) without locking in UI details.

## When to Write Detailed Specs

Write Phase 4+ feature files when:
- The foundation specs in `specs/traces-v2/` are implemented and behind a feature flag
- At least 2 weeks of internal dogfooding has happened on the foundation
- User feedback from dogfooding has informed how people actually use the trace viewer
- The specific intelligence feature is next in the build queue (not speculative)

## Consequences

- Phase 4+ intelligence features remain described only in the design doc, not as Gherkin specs
- The foundation specs explicitly note extension points where intelligence features will plug in (e.g., contextual alerts in `trace-drawer-shell.feature`, AI query in `search.feature`)
- Architectural decisions (state management, API layer) should account for Phase 4+ requirements even though the features aren't spec'd in detail
- This is a deliberate choice, not a gap. Reviewers should not flag missing Phase 4+ specs as incomplete work.
