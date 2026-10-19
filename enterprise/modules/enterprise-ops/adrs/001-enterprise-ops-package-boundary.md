# ADR-001: Enterprise ops package boundary

**Status:** proposed

**Behavioural contract:** [Enterprise operator views](../specs/enterprise-ops.feature)

## Context

Cloud admin staff need operator views over Enterprise subjects (the license
registry, activation codes, self-hosted installs), which core `ops` must not
serve (ARCHITECTURE.md section 3).

## Decision

`enterprise-ops` owns those operator views and no data. Each
`EnterpriseOpsApi` operation admits staff through `OpsApi`, then forwards to
`LicensingApi`, the owner, with the staff member recorded.

## Public surfaces and transports

Two tRPC namespaces: `licenseRegistry.*` and `selfHostedInstances.*`
(read only). They carry no org RBAC permission: the signed-in operator is a
fact, and the application admits only Cloud admin staff. Reads need staff;
writes need `ops:manage` as well. Anyone else, or any deployment where ops's
cloud-ops capability is off, is answered `not_found`.

## Dependencies

`OpsApi`, `LicensingApi` and `AuditLogApi`. No members.

## Persistence

None; licensing owns every row.

## Runtime and registration

`enterpriseOpsProcessModule` registers the Api and the two tRPC transports.
No repository, pipeline, job or subscriber.

## Environment and configuration

None.

## Errors

`not_found` for a caller who is not admitted, `permission_denied` for a write
without `ops:manage`; neither is audited. Licensing's errors pass through.

## Contracts and validation

Input and output schemas are licensing's contract schemas, reused by the tRPC
declarations.

## Consequences

Every admitted read and command lands on the audit log; core ops declares
neither namespace.
