# ops

`ops` owns platform administration and operator capabilities available to every
deployment, not Enterprise-only code.

- `contract/`: portable Zod DTOs, errors, operator result types, and `OpsService`.
- `server/`: process-owned services and private Prisma/Redis adapters.
- `web/`: browser-safe clients, formatters, JSON inspection, and reusable
  operator controls.

The app still owns transport registration, auth/session lookup, and process
composition. Ops snapshots are read, written, and streamed through the single
`OpsSnapshotService`; scheduler controls are methods on the canonical
`OpsService`, backed by app-provided persistence, audit and wake adapters plus
the canonical Project service.
The Ops server owns backoffice resource queries behind private repositories;
generated Prisma does not cross the contract or transport boundary.

## Operator journey

An authenticated platform admin opens Backoffice, searches a user, supplies an
audited reason before impersonating, and can stop that session from the shared
Ops presentation. Operators can also inspect or clean blob storage through the
existing app transport; authorization and irreversible-action safeguards stay
at that transport edge.
