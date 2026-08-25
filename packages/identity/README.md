# @langwatch/identity

The isomorphic identity core
([ADR-101](../../dev/docs/adr/101-identity-pipeline-and-identifiers.md),
[ADR-115](../../dev/docs/adr/115-identity-ships-as-packages.md)): what the
frontend and the backend must agree on about a user's sign-in identifiers,
and nothing that reads or writes.

```text
 vocabulary   providers · lifecycle states · verification methods ·
              arrivalStateForProvider · identifierProviderFor
 identifier   normalizeIdentifierValue · identifierDomain
 facts        the six fact payloads and the five command inputs (zod, with
              inferred types) · IdentifierFact · IdentityHeads
 reduce       reduceIdentity(heads, fact) — the one reducer, folded by the
              app's projection and by the replay proof alike
 errors       the refusal family (identity_identifier_not_found, …) and the
              two verification codes
 backfill     backfillParityDiffs · orphanedIdentifierRows — what "proven"
              means for one user's history
```

`tsconfig.json` declares `"types": []`: a `node:*` import or a `Buffer`
reference does not compile here, which is the whole boundary. Deriving an
identifier id, hashing a value, reading heads, appending a fact — all of
that is [`@langwatch/identity-server`](../identity-server/README.md), over
repository interfaces the app implements with Prisma and composes once in
`platform/app/src/server/app-layer/identity/runtime.ts`.

Spec: `specs/identity/identifier-model.feature`.
