# @langwatch/actor

The actor vocabulary: one closed answer to "who caused this action", minted
at the boundary that authenticated it and carried to every durable record.

Two layers, on purpose:

- `Actor` is the rich, in-process identity — a discriminated union over
  `user` (with optional impersonator), `api_key`, `system` (a closed set of
  named platform surfaces, `SYSTEM_ACTORS`), and `internal` (platform-initiated
  work attributed to the code path that did it, never anonymous).
- `LedgerActor` is the durable record stamped onto ledger facts. Its shape
  (`{ type: "user" | "system", id }`) is frozen by every event already
  written; `toLedgerActor` is the one serialization seam. No call site builds
  a `"system:..."` or `"apikey:..."` string by hand.

`ledgerActorFor({ userId, apiKeyId, fallback })` is the composition helper
for boundaries that hold raw ids: the person wins over the credential, the
credential over the surface.

The package has no dependencies and no node imports (enforced by the
tsconfig's empty `types`), so any surface — frontend, backend, workers —
names actors from the same vocabulary.

Spec: `specs/rbac/authz-grants.feature` (Attribution section).
