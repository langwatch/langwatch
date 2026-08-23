# @langwatch/identity-server

The server-side runtime of the identity platform
([ADR-101](../../dev/docs/adr/101-identity-pipeline-and-identifiers.md),
[ADR-115](../../dev/docs/adr/115-identity-ships-as-packages.md)), in the
app-layer service/repository shape: **service classes over repository
interfaces**, with no storage engine and no event-sourcing framework in the
package.

```text
 IdentityHeadsRepository (interface)          reads over the Identifier projection
                                              and User.userHashKey
 IdentityLedger (interface)                   commit(command, facts) — THE emission
                                              seam; the app appends waited, folds
                                              on the calling path, stages last
 IdentityVerificationRepository (interface)   the PKCE record: replace / find / consume
 IdentityBackfillRepository (interface)       the legacy rows a pass adopts and proves
 IdentityUsersRepository (interface)          the guarded userHashKey write

 IdentityGuards                veto-before-write; shared by the calling path and
                               the queue's staged re-run
 IdentityService               attach / verify / markPrimary / detach / erase
 VerificationCeremonyService   magic link + PKCE, id-pinned, single-use
 IdentityBackfillService       one user's pass: adopt → establish → detach → prove

 crypto/                       deriveIdentifierId · computeIdentifierHash ·
                               mintUserHashKey · s256Challenge
 ./better-auth                 createIdentityDatabase — the routing facade over
                               the stock prismaAdapter, the routing table, the
                               account/user ceremonies, the transaction guard
```

Nothing here reads the environment or a database. The write gate, the
clock and the command-id minter arrive as closures; the app implements the
five interfaces with Prisma and its event-sourcing pipeline
(`platform/app/src/server/app-layer/identity/{repositories,ledger.ts}`) and
composes every service once in
`platform/app/src/server/app-layer/identity/runtime.ts`. The pure half —
vocabulary, facts, the reducer, the refusal errors — is
[`@langwatch/identity`](../identity/README.md).

Server-only by construction: nothing in the browser reaches this package,
and the app's frontend-boundary test fails the build if that changes, so
`node:crypto` lives on the root entry rather than behind a subpath.

Spec: `specs/identity/identifier-model.feature`,
`specs/identity/auth-path-redis-loss.feature`.
