---
paths:
  - "**/*.errors.ts"
  - "packages/handled-error/**"
  - "modules/*/process/src/services/**"
  - "modules/*/process/src/transport/**"
  - "enterprise/modules/*/process/src/services/**"
  - "enterprise/modules/*/process/src/transport/**"
---

# Errors

Read `dev/docs/best_practices/error-handling.md` and ADR-045. Throw a
`HandledError` only when the cause is known and the caller can act on it.
Everything else stays a plain `Error` and degrades to a generic "unknown" plus a
trace id; never dress an infrastructure failure up as handled.

- A new code goes in `packages/handled-error/src/app-codes.ts` (sorted)
  with a customer-safe entry in `packages/handled-error/src/presentation.ts`
  in the same change. That registry is the words a customer reads.
- `message` is customer-safe: no env vars, hostnames or internal service names.
- A 5xx subclass sets `fault` (`platform` or `provider`) explicitly. One that
  declares none gets `presumed_platform`: logged at error, reported, its body
  masked (§12, 2026-10-05). Below 5xx an undeclared fault stays `customer`.
- Customer copy goes in the presentation registry, tips and the docs link in
  `packages/handled-error/src/remediation.ts` (§12).
- `meta` is a client contract: name the consumer before adding a field.
  Validation errors carry `meta.fieldErrors`.
- A knowable failure surfacing as "unknown error" is a bug. Name expected
  failures in the spec, each with a tagged, bound scenario.
