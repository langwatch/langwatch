# Process-manager visibility in Ops

Status: built (all three phases; alert routes remain infrastructure-owned)
Date: 2026-08-13

Behavioural contracts: [process-manager visibility](../../specs/ops/process-manager-visibility.feature)
and [event-subscriber visibility](../../specs/ops/event-subscriber-visibility.feature).
The shared process-manager rules are in [ADR-049](adr/049-langy-projection-independent-reactions.md);
the page follows the layout conventions in [ops-dashboard.md](best_practices/ops-dashboard.md).

## Current surface

`/ops/processes` provides a fleet strip, a per-process table, process-key
search, and an instance drawer. The drawer shows state JSON, paged outbox
messages, and trace links from each message's stored carrier. Wake-now,
redrive-dead, and release-lapsed-lease actions are audited under
`targetKind: "process_instance"` and recent actions are shown on the page.
The same page lists the event-subscriber registry alongside live queue health;
pause and unpause use the existing pipeline controls.

The fleet reads through `ProcessOpsPrismaRepository` and
`ManagerExplorerService`. Cross-tenant aggregates use the substrate's explicit
tenancy opt-out; keyed reads and writes retain their project guard. No new
index is required: the existing retention-bounded indexes carry the reads.
The app metrics adapter exports global `pm_*` gauges per pod, so dashboards
aggregate them with `max()`, not `sum()`.

An outbox lease is not renewed during delivery. A lapsed lease therefore means
“died or still delivering” until the fencing token is checked; the UI must not
teach operators to redrive in-flight work. The stored W3C `traceCarrier` is
the authoritative link to the producing trace, avoiding log searches.

## Ownership and residuals

The process-manager repository, app transport, worker registration, and
Prometheus adapter remain in `platform/app/src/server/app-layer/ops` because
they compose the shared process-manager substrate and application auth. The
Ops package owns the reusable presentation and operator contract surfaces; its
package tests bind those portions to the scenarios above. Alert routes and
retention/index operations remain infrastructure/runbook concerns. This file
records the shipped boundary; implementation sketches and unresolved questions
from the original plan were removed once the three phases were built.
