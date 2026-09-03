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
                                              seam; the app appends waited, stages
                                              onto the queue, and waits for the fold
 IdentityVerificationRepository (interface)   the PKCE record: replace / find / consume
 IdentityBackfillRepository (interface)       the legacy rows a pass adopts and proves
 IdentityUsersRepository (interface)          the guarded userHashKey write and the
                                              user's email a ceremony records

 IdentityGuards                veto-before-write; shared by the calling path and
                               the queue's staged re-run. A promotion and an
                               erasure also ROUTE: they read the whole person and
                               state one fact per stream that has to move, which
                               is what a per-identifier fold cannot sweep for
                               itself (ADR-127)
 IdentityService               attach / verify / markPrimary / detach / erase
 VerificationCeremonyService   magic link + PKCE, id-pinned, single-use
 IdentityBackfillService       one user's pass: adopt → establish → detach → prove

 IdentityCeremonyWrites        the write surface sliced by ROLE, so a collaborator
 IdentityVerificationWrites    takes a named contract rather than a Pick<> of the
 IdentityAdoptionWrites        service class (IdentityService implements all three)

 crypto/                       deriveIdentifierId · computeIdentifierHash ·
                               mintUserHashKey · s256Challenge
 identity-command-id           every form a command id takes, in one place
 identity-backfill-plan        what the legacy rows imply, as a pure plan
 ./better-auth                 IdentityCeremonies — what a row write MEANS,
                               bound to better-auth's databaseHooks — and
                               createIdentityStorageAdapter, better-auth's whole
                               `database:` entry. The only contact with the library
```

Nothing here reads the environment or a database. The write gate, the
clock and the command-id minter arrive as closures; this package implements
the five interfaces with Prisma and its event-sourcing pipeline
(`repositories/prisma/`, `adapters/`), and
`apps/api/src/app/api-trpc-collaborators.identity.composition.ts` composes
every service once. The pure half — vocabulary, facts, the reducer, the
refusal errors — is
[`@langwatch/identity-contract`](../contract/README.md).

Server-only by construction: nothing in the browser reaches this package,
and the app's frontend-boundary test fails the build if that changes, so
`node:crypto` lives on the root entry rather than behind a subpath.

better-auth appears only as a PEER, and only on the `./better-auth` subpath.
The root entry — and therefore every service — is free of the library
entirely.

`createIdentityStorageAdapter` IS better-auth's `database:` entry (ADR-116
§1): the implementation `createAdapterFactory` is built AROUND, never a
wrapper over a finished one. That distinction is mechanical, not stylistic.
better-auth satisfies its own `join: { account: true }` with a second query
issued through the instance the factory was built around, and runs sign-up
inside `adapter.transaction` — both below any wrapper, and both on this
adapter at this level. Inside it, the per-user gate routes between
better-auth's own published Prisma engine (legacy users, verbatim) and
event-sourced storage (latched users: linkage as facts, secrets in
`AccountCredential`, reads from `Identifier` ⋈ `AccountCredential`). It still
implements no storage of its own — the identity branch runs on the
`IdentityAccountsPort` / `IdentityResolutionPort` ports the app fills with
Prisma, and the legacy branch is the library's engine handed in.

The gate ships closed, so every user takes the legacy branch until an
operator enrolls one;
`src/__tests__/identity-storage-adapter-legacy.unit.test.ts` walks the whole
flow over both engines and compares the transcripts, which is what makes
that a checked claim rather than an asserted one.

Spec: `specs/identity/identifier-model.feature`,
`specs/identity/identity-storage-adapter.feature`,
`packages/features/identity/specs/package-boundary.feature`.
