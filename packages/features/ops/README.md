# ops

`ops` owns platform administration and operator capabilities available to every
deployment, not Enterprise-only code.

- `contract/`: portable Zod DTOs, errors, operator result types, and `OpsService`.
- `server/`: process-owned services and private Prisma/Redis adapters.
- `web/`: browser-safe clients, formatters, JSON inspection, reusable operator
  controls, the controlled DejaView workspace, and the Foundry trace editor/emitter.

The app still owns transport registration, auth/session lookup, and process
composition. Ops snapshots are read, written, and streamed through the single
`OpsSnapshotService`. Scheduler and queue controls are methods on the
canonical `OpsService`; queue Redis state and DLQ audit writes stay private to
the server package, while payload decoding is a named app storage adapter.
The Ops server owns backoffice resource queries behind private repositories;
generated Prisma does not cross the contract or transport boundary.

## Operator journey

An authenticated platform admin opens Backoffice, searches a user, supplies an
audited reason before impersonating, and can stop that session from the shared
Ops presentation. Operators can also inspect or clean blob storage through the
existing app transport; authorization and irreversible-action safeguards stay
at that transport edge.

The Foundry page and drawer compose their selected project and prompt-loading
transport hook in the app. The Ops web package owns the editor, presets, trace
generation, browser-side OTel emission, and presentation state.
The DejaView page follows the same boundary: the app supplies tRPC results and
handled-error rendering, while the web package owns URL-fragment state,
keyboard navigation, and the complete search/replay presentation.

## Behavioural contracts

Package-owned worker, queue, and presentation contracts live beside the
implementation:

- [Admin](./specs/admin.feature)
- [Latency windows](./specs/dashboard-latency-windows.feature)
- [Tenant rate anomalies](./specs/event-queue-anomaly-detection.feature)
- [Tenant-scoped queue drain](./specs/event-queue-resilience.feature)
- [Pending-counter reconciliation](./specs/pending-counter-reconcile.feature)
- [Queue discovery](./specs/queue-discovery.feature)
- [Queue-group state](./specs/queue-group-state.feature)

Some contracts remain at the repository boundary because they describe a
composed app or shared infrastructure rather than one package surface:
[dead-letter recovery](../../../specs/ops/dead-letter-recovery.feature),
[scheduler control](../../../specs/ops/scheduler-operator-control.feature),
[the shared snapshot](../../../specs/ops/shared-ops-snapshot.feature),
[process visibility](../../../specs/ops/process-manager-visibility.feature),
and [Ops dashboard density](../../../specs/ops/ops-dashboard-density.feature).
The app owns their transport/composition assertions; the package tests still
bind the package portions to named scenarios.

The shared architectural decisions [ADR-090](../../../dev/docs/adr/090-shared-ops-snapshot-single-writer.md)
and [ADR-091](../../../dev/docs/adr/091-operator-control-over-the-scheduler.md)
remain in the repository ADR catalogue because they govern process and app
composition, not only this package. The remaining root `specs/ops` contracts
cover ClickHouse, email, feature flags, local observability, and production
bundle infrastructure, so they are intentionally not duplicated here.
