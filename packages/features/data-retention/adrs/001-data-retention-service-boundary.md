# Data Retention service boundary

Data Retention owns retention policy vocabulary, scope resolution and policy
persistence. Its contract is portable Zod 4 data and one abstract
`DataRetentionService`. The server package keeps Prisma persistence private and
exports only the Prisma composition adapter. Existing pinning, metering and
retroactive ClickHouse work remain compatibility seams until they can be moved
behind this service without duplicating lifecycle ownership.

The service throws for invalid or missing scope targets. The only nullable
lookup is named `tryGetPolicyById`; repositories use the corresponding `try*`
names. Project → team → organization resolution is most-specific-first and
falls back to the platform default.

The retention repository owns only retention-policy rows. Scope lineage comes
from the canonical `ProjectService` and `OrganizationService`; Data Retention
does not read their tables. Boot validates and injects the platform default, so
the portable contract never reads environment state during module import.
