# ops

`ops` owns platform administration and operator capabilities available to every
deployment, not Enterprise-only code.

- `contract/`: portable Zod DTOs, errors, operator result types, and `OpsService`.
- `server/`: process-owned services and private Prisma/Redis adapters.
- `web/`: browser-safe clients, formatters, and reusable operator controls.

The app still owns transport registration, auth/session lookup, and composition.
The Ops server owns backoffice resource queries behind private repositories;
generated Prisma does not cross the contract or transport boundary.
