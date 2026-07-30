Feature: Pipeline model (retired shape — see pipeline-declaration.feature)

# This file specified the pre-ADR-105 pipeline shape: a `StaticPipelineBuilder`
# assembled by calling `.withName()`, `.withAggregateType()`,
# `.withFoldProjection()`, `.withMapProjection()` and `.withProjection()` on a
# builder, separately from the aggregate identity and from the event
# vocabulary — three registries (fold, map, and the "state projection" third
# kind ADR-098 decision 1 collapsed away) rather than the two ADR-098 keeps.
# All of it lived only in `event-sourcing.old/`; nothing in the live pipelines
# builds a pipeline this way any more.
#
# ADR-105 replaces the whole shape: `definePipeline(name).prefix(...)
# .events(...).id(...)` is one chain, not a builder assembled from separate
# calls, and an aggregate's identity is declared once, on the chain itself,
# never as a field set apart from the events it identifies. What this file's
# scenarios tested is now specified in pipeline-declaration.feature.
#
# The one rule here without a confirmed successor: ADR-082's "a pipeline
# dependency is never a value the builder registers" — collaborators must be
# constructed at the mount, never injected pre-built — was checked mechanically
# against a shrink-only violations list. ADR-105 decision 6 states the same
# design principle ("collaborators arrive by construction, at the mount"), but
# nothing found in `@langwatch/event-sourcing` yet re-implements the mechanical
# check itself. If that check is still wanted, it is new work against the new
# chain, not a port of the old one.
