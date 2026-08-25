# Data Retention service boundary

Data Retention owns the portable Zod 4 retention and trace-pin vocabulary,
policy cascade, policy persistence, and pin lifecycle. The contract has one
abstract `DataRetentionService`; the server keeps Prisma repositories and
service implementations private and exposes only its composition adapter.

Policy resolution is project → team → organization, most-specific-first, with
an injected platform default. An injected 60-second cache is invalidated for
every affected project after writes. Missing project/scope context preserves
the legacy platform-default result for reads/previews; writes raise the
portable `ScopeTargetNotFoundError`. Invalid values are rejected at the
service boundary. The only nullable policy lookups are named `try*`.

Policy persistence is isolated to retention-policy rows; scope lineage is
resolved through canonical project and organization collaborators. Pinning is
an annotation capability: it never changes retention stamps or ClickHouse TTLs.
Share owns the cross-feature rule that rejects manual unpinning while a link is
active, then delegates the pin removal here. This keeps both services acyclic.

Boot validates and injects the platform default, so the portable contract never
reads environment state during module import.
