# @langwatch/ai-onboarding

The anonymous front door: `npx langwatch <agent>` provisions a temporary,
claimable workspace with an ingestion-only key, and a claim flow later attaches
a real identity to it.

Consumed by exactly one place — `src/app/api/agent-onboarding/[[...route]]/`.
That is deliberate. The domain has one entry point, so a second caller has to
come through the RPC service rather than reaching past it into a repository.

## Layout

Mirrors the Go services (`services/aigateway`), because it is the same shape:

```
src/domain/     entities, lifecycle arithmetic, errors, crypto, config
src/app/        ports.ts + the services that depend only on ports
src/adapters/   the outward-facing half
```

`src/app/ports.ts` is the whole seam, the way `app/ports.go` is over there.
Services see ports; adapters implement them; nothing in `domain/` or `app/`
imports an adapter.

### What is *not* here

The Prisma repository. Its client is generated from the app's schema, so a
package importing `@prisma/client` would typecheck against whatever stub
happened to be installed beside it. The **port** lives here; the binding lives
in the route's composition root, next to the EE workspace provisioner for the
same reason.

The Redis adapters *are* here, because they depend on `RedisLike` — a
structural interface this package declares — rather than on `ioredis`. The app
injects the connection it already has; a unit test injects a Map.

## The two moving parts

**The unclaimed ramp.** Ingestion stops at day 7, deletion at day 30. Both are
columns; the *state* is always derived from them (`deriveState`), never stored.
A stored status field is a second source of truth that goes stale the moment a
job runs late, and this value backs a countdown a developer reads in their
terminal. Claiming nulls both columns, which is also what takes the row off the
reaper's work list (`deleteAfter <= now` can never match a null).

**Rate limiting.** `/provision` creates real rows from an unauthenticated
request, so it is metered on four axes at once — fingerprint, IP, IP subnet,
global — tightest first, short-circuiting so a blocked caller does not also
burn the shared budget of everyone behind their NAT. Provisioning fails
**closed** when Redis is down; claiming fails **open**, because a claim already
carries a token that proves possession and locking an owner out on day 29 is
worse than the abuse it would prevent.

## Secrets

Nothing identifying is stored raw. Claim tokens, handoff codes, fingerprints
and addresses are all HMAC'd with a pepper derived from the app secret, so a
database dump cannot be replayed into someone's workspace or reversed into
"which machines tried LangWatch". Equality still works, which is all the abuse
checks need.

PKCE verifiers are never stored at all — only the challenge they must hash to.

## Testing

```bash
pnpm --filter @langwatch/ai-onboarding test:unit
```

Every port has a fake in `src/__tests__/fakes.ts`, including a hand-moved
clock: the lifecycle arithmetic is the thing under test, so it must never
depend on how long the suite takes to run. `FakeAccountRepository.markClaimed`
mirrors the real conditional UPDATE (it refuses when `claimedAt` is already
set), which is what the double-claim tests rely on.

## Specs

`specs/ai-governance/agent-onboarding/` — provisioning, claim handoff, rate
limiting, lifecycle.
