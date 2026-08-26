# ops

`ops` owns platform administration and operator capabilities available to every
deployment, not Enterprise-only code.

- `contract/`: portable Zod DTOs, errors, operator result types, and `OpsService`.
- `server/`: process-owned services and private Prisma/Redis adapters.
- `web/`: browser-safe clients, formatters, JSON inspection, reusable operator
  controls, and the Foundry trace editor/emitter.

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
