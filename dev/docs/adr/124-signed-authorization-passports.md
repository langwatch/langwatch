# ADR-124: Signed authorization passports — the L2 rung, made buildable

**Date:** 2026-08-25

**Status:** Proposed (2026-08-25)

**Builds on:** [ADR-092](092-unified-authorization-engine.md) §12 (the epoch
ladder; this ADR is its L2 rung, and the only part of §12 it changes is the
one sentence about fan-out — see Context #3), §1 (the append-only registry,
whose freeze exists for this), §4 (the `{actor, subject}` shape).

**Paired with:** [ADR-123](123-an-agent-session-is-a-principal.md), written the
same day on the same branch. ADR-123 decides *what an agent session is*; this
decides *what crosses the wire when one runs*. Neither is implementable
without the other, and neither restates the other: ADR-123 §4 says the
passport is the credential and states what that costs; this says what a
passport is, how it is verified, and how a revocation reaches it.

**Related:** [ADR-093](093-redis-is-an-owned-client.md) (the epoch store's
Redis is an owned client), [ADR-110](110-grant-aggregates-are-grants.md) (the
projection cursor §12's amendment points the version integer at),
[ADR-045](045-domain-errors-handled-boundary.md) (`fault`, and what a
verification failure may say), [ADR-070](070-modular-package-architecture.md)
(why the codecs get a subpath and not the barrel),
[ADR-033](033-langy-worker-network-isolation-under-gvisor.md) (the process
boundary a passport crosses first). PR #7532 (the free-list wave that turned
the epoch cache on, which is what makes an L2 rung meaningful).

**Numbering:** 124 was **assigned by the orchestrator**, not derived. Several
ADRs are being drafted concurrently on separate worktrees; 117-123 are spoken
for (123 was written on this worktree hours ago) and picking the next number
from `ls dev/docs/adr/` would have collided. Deriving a number from `main`
alone is the standing trap.

## Context

### 1. Everything the passport needs already ships, except the passport

ADR-092 §12 describes a three-rung ladder. Two rungs are live code:

- **L0/L1.** `AuthzService` holds one collected-grants snapshot per principal
  per organization, valid only while the org's epoch is unchanged, with an
  absolute age ceiling so a wedged store cannot pin a stale snapshot
  (`packages/authz-server/src/authz.service.ts:20-24`, the cache read at
  `:450-490`). The epoch itself is a Redis `INCR` per organization
  (`platform/app/src/server/app-layer/authz/epoch.ts:16`, `bumpAuthzEpoch` at
  `:60-72`), and the cache defaults on since PR #7532.
- **The bitset core.** `encodePermissionBitset` / `bitsetHasPermission` are
  real, and on the browser-safe barrel (`packages/authz/src/bitset.ts`). The
  registry is append-only *because of this ADR* — the rule is written at
  `packages/authz/src/registry.ts:20-24` ("bitset indices (stage F passports)
  are derived from declaration order") and again at `:208-212`, and it is
  enforced twice: sentinel indices, and the **full serialization order**,
  whose test comment says why in one line — *"bitset indices ship inside
  signed passports"*
  (`platform/app/src/server/app-layer/authz/__tests__/registry.unit.test.ts:99-119`).
  126 permissions is a **16-byte** bitset. A principal's whole per-scope
  answer fits in a header.

What does not exist is any code that mints or checks one. The package README
says so in as many words — no `passport.ts`, no `PassportService`, no
`./passport` export (`packages/authz/README.md:51-53`, the term entry at
`:247`) — and reserves `AUTHZ_PASSPORT_SECRET` for work nothing reads yet
(`:327-329`). This ADR is the design that README points at, and the two must
stay consistent: when this lands, those lines change with it.

### 2. There is a consumer with a live need, and it is not the one §12 named

§12 lists the L2 audience as "collector, Go gateway, share links" — all
optimizations. None of them is broken today.

ADR-123 supplies a consumer that is. A Langy turn executes in an isolated
worker process whose only LangWatch transport is a CLI authenticating with a
bearer in its environment
(`services/langyagent/adapters/opencode/provision.go:486-494`), so
**something bearer-shaped must cross that boundary** — ADR-123 argues this at
length and this ADR takes it as given. What crosses today is a stored `ApiKey`
row with a six-hour TTL, and the sprawl it produces is measured in our own
source: *"41 keys minted, 14 ever used"*
(`platform/app/src/server/app-layer/langy/LangyCredentialService.ts`, the
`getOrProvision` docstring), managed by a name-and-tenant-gated system
revocation path (`langyApiKey.ts:128-182`) and an expiry reaper (`:202-224`).
Meanwhile the actor rides the same wire as an *unsigned JSON field* —
`actorUserId` in the turn payload
(`services/langyagent/transport/rpc/rpc.go:51`,
`transport/rpc/handlers.go:65,139`) — beside a credential that knows nothing
about it.

So the ship order is settled before we start: the passport goes first to the
surface with a security finding behind it, and second to the surfaces that
only want to be faster.

### 3. Three things §12's sketch assumes that the code does not provide

This is the part worth being blunt about. §12's L2 line reads:

```text
 verify = HMAC + in-memory epoch compare → zero DB, revocation ≤ fanout lag
```

Each clause hides a decision that has to be made here.

**(a) "In-memory epoch compare" presumes a fan-out that does not exist.** §12
says the epoch is "fanned out via pub/sub". There is no publisher and no
subscriber. `bumpAuthzEpoch` calls `INCR` and returns (`epoch.ts:60-72`);
`getAuthzEpoch` does a `GET` on every collect that misses the memo
(`authz.service.ts:459`). That is a **pull**, one round trip, and it is
exactly right for L1 — an app process holding a Redis connection can afford
it, and "cannot read the epoch" degrades safely to "collect fresh from
Postgres" (`epoch.ts:18-29`). It is not available to L2. A verifier that could
read Postgres would not need a passport.

The good news is that the fan-out is *also* already built, in the one place
that needs it. The Go gateway runs an org-scoped **change feed**: a monotonic
per-org revision in Postgres (`GatewayChangeEvent`,
`platform/app/src/server/gateway/changeEvent.repository.ts:1-6`), long-polled
at `GET /api/internal/gateway/changes` for ~10s with a `current_revision`
returned on both the 200 and the 204
(`services/aigateway/adapters/controlplane/client.go:185-235`), driving a
per-org cursor the resolver advances
(`services/aigateway/adapters/authresolver/service.go:84-88`, `orgCursor` at
`:130-133`). The passport does not need to invent a fan-out. It needs to
**join one that ships**, and we need to stop calling it pub/sub.

**(b) A carried permission bitmap freezes an intersection ADR-123 needs live.**
§12's L2 object is `{ principal, scope→permission-bitmap, epoch, exp }` — the
answer travels with the claim. For a share link or a collector that is the
whole point. For an agent session it is the exact defect ADR-123 §2 sets out
to remove: today's key computes the held subset once, at mint
(`platform/app/src/server/app-layer/langy/langyApiKey.ts:312-343`), and
ADR-123 requires both operands of the ceiling to be collected live, in both
directions, so that promoting alice mid-conversation takes effect on her next
request. A passport that carries a precomputed bitmap re-introduces the
mint-time snapshot in a new wrapper.

**(c) `exp ≤ 60s` and "a credential sitting in a worker's environment" are not
compatible without something.** A Langy turn can run for minutes. The
gateway's own precedent solved the same problem with a 15-minute token and an
asynchronous refresh at T+10
(`platform/app/src/server/gateway/gatewayJwt.ts:15-16`). Sixty seconds needs
an answer, not silence.

### 4. What the gateway JWT already teaches

`gatewayJwt.ts` is the in-house precedent §12 cites, and it is a good one. It
mints HS256 with a dedicated secret (`LW_GATEWAY_JWT_SECRET`, `:47-55`), pins
issuer and audience on both sides (`:82-86`, `:92-95`), bounds the token by
`min(TTL, the underlying credential's own expiry)` so a token can never
authorize past the thing it was minted for (`:66-77`), and carries a
`revision` claim the gateway uses to know when its cached answer is stale
(`:32`). The Go half already exists as a shared package with **rotation built
in** — current secret, then previous secret, and the HMAC method pinned inside
the `Keyfunc` so `alg` cannot be talked down
(`pkg/jwtverify/verifier.go:47-71`), wired for the gateway at
`services/aigateway/deps.go:121-126`.

Three things the passport deliberately does differently, and each is a
decision below: **≤60s rather than 15 minutes** (§5 and §6), **an epoch rather
than a per-credential revision** (§3), and **registry bitsets rather than role
strings** (§2, Rationale).

## Decision

### 1. A passport has two modes, and the mode is what it means

```text
 ASSERT MODE                              CARRY MODE
 "this request is alice, acted for by     "…and here is the answer, so you
  langy, at project chatbot"               need not resolve anything"
 ┌──────────────────────────────────┐     ┌──────────────────────────────────┐
 │ subject · actor · authority      │     │ subject · actor · authority      │
 │ scope · org · epoch · exp        │     │ scope · org · epoch · exp        │
 │                                  │     │ + prm: scope → 16-byte bitset    │
 └──────────────────────────────────┘     └──────────────────────────────────┘
 verifier HAS the engine                  verifier has NO engine and no DB
 → verify signature, then decide          → verify signature, then bit-test
   LIVE through AuthzService (L1)           the carried bitset
 → both ceiling operands stay live        → the answer is as old as the epoch
                                            it was stamped under, and no older

 who        the LangWatch API taking a    the Go gateway · the collector ·
            Langy tool call (ADR-123)      a share-link render
```

**This is the central decision of the ADR, and it is the one §12 does not
make.** A passport's job is to say *who is asking, provably, without a
lookup*. Carrying the answer as well is an optimization for verifiers that
cannot compute one — not part of the definition. Splitting the two lets
ADR-123 have a signed principal with live grants, which closes Context #3(b),
without giving the collector a database connection.

A verifier declares which mode it accepts and **refuses the other**. A
verifier that can decide must not accept a carried answer: it would be
trusting a snapshot with a live answer available. A verifier that cannot
decide must not accept an assert-mode passport: it has no way to turn one into
a decision, and the only thing it could do instead is guess. Mode confusion is
exactly the kind of thing that looks like a graceful fallback and behaves like
an authorization bypass.

### 2. Wire shape: an HS256 JWT envelope, a dedicated secret, private claims

```text
 header   { "alg": "HS256", "typ": "JWT", "kid": "p2" }

 claims   registered, with their registered meanings — so nothing generic
          can misread them:
          iss  "langwatch-control-plane"    same issuer as the gateway JWT
          aud  "langwatch-authz"            DIFFERENT audience. On purpose.
          iat  1756108800
          exp  1756108860                   ≤ iat + 60, and ≤ every other
                                            bound the minter was given (§6)
          sub  "user_2f8…"                  THE SUBJECT: whose grants resolve

 private, short, meaningful only under this audience:
          v    1                            FORMAT VERSION — read first
          sbk  "user"                       subject kind   (CALLER_KINDS)
          act  "agent:langy"                THE ACTOR      (ADR-123 §1)
          atk  "agent"                      actor kind
          aut  "delegated"                  own | delegated | assumed
          org  "org_9k…"                    tenancy anchor AND which epoch
          scp  [{"t":"project","id":"proj_…"}]
          epo  5821                         the version it was minted under
          es   "redis-epoch"                WHICH counter that integer is
          prm  { "proj_…": "AAgAEA…" }      CARRY MODE ONLY: base64url of the
                                            16-byte registry bitset per scope
```

**`v` is required and is the first thing a verifier reads.** Not a byte in the
literal sense — inside a JSON claim set an integer is cheaper than a prefix and
does the same job — but load-bearing in the same way. The layout will change:
the first change is already visible, `es` collapsing when the projection cursor
becomes the only source (§3). A verifier must refuse a version it does not
implement rather than read absent fields as defaults. An unknown `v` is a
refusal, never a best-effort parse.

**HS256 with a dedicated `AUTHZ_PASSPORT_SECRET`** — the variable
`packages/authz/README.md:327` already reserves.

- *Alternative: reuse `LW_GATEWAY_JWT_SECRET` and the gateway's signer.* Fewer
  secrets to manage, and the Go verifier is already constructed
  (`services/aigateway/deps.go:121-126`). Rejected on blast radius: the two
  tokens have different lifetimes, different revocation models and different
  audiences, and sharing a key means the only thing standing between a gateway
  token and an authorization decision is an `aud` check on one code path. A
  dedicated secret makes that structural rather than vigilant. It also means
  rotating one does not rotate the other, which matters because the passport
  secret will rotate on a shorter cadence than a gateway secret ever has.
- *Alternative: a bespoke compact format (`lwp1.<payload>.<mac>`) with no
  `alg` field at all.* Genuinely attractive: it deletes the
  algorithm-confusion class by construction rather than by pinning, and the
  verify is one HMAC, one `timingSafeEqual` and one `JSON.parse`. Rejected
  because `pkg/jwtverify` exists, pins the HMAC method inside its `Keyfunc`
  (`verifier.go:65-70`), and already models the rotation this needs; a bespoke
  format means writing and reviewing a second Go crypto path for a class the
  existing one handles. The pinning is not optional in either language and
  gets its own scenario — a passport signed `alg: none`, or with an
  asymmetric key, must fail in TypeScript and in Go.
- *Alternative: asymmetric (Ed25519), so a verifier holds no minting key.* The
  right end state if a passport ever has to be verified somewhere we do not
  operate. Nothing on the ship list (§7) is outside our own deployment, and
  HMAC is the cheaper verify on a path measured in microseconds. Named here
  because the `kid` header — present from v1 — is the seam that makes the
  change possible later without a format break.

**Where the code lives.** Minting and verification go behind
`@langwatch/authz/passport`, a **subpath export**, never the barrel: they need
`node:crypto` and `Buffer`, and the barrel is imported by `useCan` in the
browser. This is the rule the README already names as the one this work will
land under (`packages/authz/README.md:208`), following
`@langwatch/authz/witness` (`packages/authz/src/witness.ts:20-25`). The
base64url codecs for `prm` go there with it; the pure bit operations stay on
the barrel where they already are.

### 3. The epoch claim names its own counter

There are three monotonic per-organization integers in this repository and
they are not interchangeable:

```text
 redis-epoch    authz:epoch:<org>, INCR on every grant write   epoch.ts:16,:60-72
                fast, shared by app processes, NOT durable —
                a flush or eviction takes it back to ABSENT

 gw-revision    GatewayChangeEvent.revision, a Postgres        changeEvent.repository.ts
                sequence, long-polled by the Go gateway        client.go:185-235

 proj-cursor    AuthzProjectionCursor, advanced by the         ADR-092 §12
                projection writer — "the write IS the bump"    amendment, 2026-08-17
```

ADR-092's 2026-08-17 amendment says the version integer *should* become the
projection cursor, and that the Redis epoch keeps being bumped unchanged until
the contract PR retires it. So the source will change **while passports are in
flight**, and two integers from different counters compared as though they
were one counter is a silent authorization bug in whichever direction the
numbers happen to fall.

**Decided: `es` is a required claim naming the counter, and a verifier whose
own knowledge comes from a different source refuses the passport.** It costs
one short string per token and turns a migration hazard into a fail-closed
mismatch. When the cursor becomes the only source, `es` collapses to a single
legal value and the claim is dropped in a `v` bump — which is what `v` is for.

**The comparison is `epo >= the verifier's epoch`, not equality.**

```text
 epo == mine   the common case. Accept.
 epo >  mine   minted under a version I have not learned yet. Accept: it
               reflects FRESHER truth than I hold, and refusing would fail
               every mint during fan-out lag.
 epo <  mine   grants moved since this was minted. REFUSE. The bearer re-mints.
 mine absent   I have no epoch knowledge at all. §4 decides this, and the
               answer is not "accept".
```

The reset hazard is real and bounded rather than solved: if the Redis key is
evicted the counter climbs again from a lower number, and a passport stamped
under the older, higher value would satisfy `epo >= mine`. Two things contain
it. `getAuthzEpoch` deliberately reads a missing key as `null` and not as 0
(`epoch.ts:18-29`, where the reasoning is already written out), so the reset
window is *absent knowledge*, which fails closed; and `exp ≤ 60s` bounds
anything that slips through. The durable cursor removes the hazard entirely,
which is one more reason the amendment's direction is right.

### 4. Verification, in order, failing closed at every step

```text
 verify(token, mode) →

  1  parse header · REJECT unless alg is HS256 and kid names a known secret
  2  HMAC over current secret, then previous secret    pkg/jwtverify:47-71
  3  iss == langwatch-control-plane · aud == langwatch-authz
  4  v is a version I implement                        else REJECT
  5  exp > now (no skew grace on the LATE side)        else REJECT
  6  es == the source my epoch knowledge comes from    else REJECT
  7  epo >= my epoch for claims.org                    else REJECT  (§3)
  8  mode matches what I accept                        else REJECT  (§1)
  9  assert mode → decide LIVE via AuthzService
     carry  mode → bit-test prm[scope]
```

Steps 1-8 are ~2 µs and touch nothing. Step 9 is where the modes diverge, and
it is the only step that can reach a datastore.

**How a verifier gets its epoch:**

```text
 the verifier is…             learns the epoch by…               lag
 ─────────────────────────────────────────────────────────────────────────
 an app process (has Redis)   the GET it already does, memoized  ≤ the memo's
                              under an absolute age ceiling —    age ceiling
                              the discipline authz.service.ts
                              :467-472 already applies to grants

 a Go service (no Redis)      the org change feed it already     ≤ ~10 s (one
                              long-polls, gaining an authz-grant long-poll
                              kind — client.go:185-235,          window)
                              authresolver/service.go:130-133

 anything, as an accelerator  a Redis pub/sub subscription on    ~ms
                              the bump
 ─────────────────────────────────────────────────────────────────────────
```

**Pub/sub is an accelerator and never the floor.** Redis pub/sub has no
delivery guarantee: a subscriber that was reconnecting when the message went
out never learns that it missed one, and a verifier treating a missed message
as "no change" holds a revoked grant until its process restarts. The poll (or
the long-poll feed) is the correctness floor; pub/sub only shortens the
window. §12's "fanned out via pub/sub" is the one sentence this ADR changes.

**No epoch knowledge is not a licence to trust the passport.** When a verifier
has never seen an epoch for the organization, or its last reading is older
than the absolute age ceiling:

```text
 ASSERT mode → the identity claims still stand: signed, unexpired, and about
               a subject whose grants this verifier can read. DECIDE LIVE.
               That is the full check — the same 1-5 ms ADR-092 §12 budgets
               for an L1 miss. Correct, just not instant.

 CARRY  mode → REFUSE the carried answer. Then either fall back to a full
               check by asking the control plane, or — for a verifier with no
               such call — DENY, fault: platform (ADR-045), logged loudly and
               counted, because a verifier that has lost its epoch is an
               incident and not a customer error.
```

The asymmetry is the point: assert mode degrades to slower-but-correct, carry
mode degrades to denied. There is no third branch in which a bitmap of unknown
age answers a question. That branch is how a passport system becomes a
fail-open system, and it is usually added by someone reducing an error rate.

### 5. Revocation, stated honestly: `min(exp, fan-out)` and nothing else

```text
 t=0    an administrator revokes alice's binding.
        The grant write bumps the org epoch     5821 → 5822
        │
        ├─ subscribed verifiers learn 5822 in                   ~ms  (pub/sub)
        ├─ app processes learn it within                  ≤ memo age  (poll)
        ├─ Go verifiers learn it within                       ≤ ~10 s  (feed)
        │
        ▼
        every passport stamped epo=5821 is refused from the moment
        ITS verifier learns 5822 …
        │
        └──────────────────────────────────────────────────────────────►
                                                        t = 60 s
        … and every one of them is dead by construction here, whatever
        any verifier did or did not learn, because exp ≤ iat + 60.

 WORST CASE a revoked grant still answers = min(time left on exp, fan-out lag)
 A verifier that has learned NOTHING refuses rather than waiting (§4).
```

**There is no per-passport revocation list, and there will not be one.** A
denylist is a lookup, and a lookup on the verify path is the entire thing L2
exists to remove; it would also need its own replication to every verifier,
which is the fan-out problem again with worse failure modes. What that gives
up, precisely:

- **Killing one bearer without changing a grant.** An operator who wants to
  stop *one* runaway agent turn and leave every other session alone cannot.
  ADR-123 §4 concedes exactly this and names the shape of the answer if it is
  ever needed — a per-conversation nonce checked alongside the epoch, which is
  the one piece of session-shaped state we would then store. Neither ADR
  builds it, and neither should until something asks.
- **Kill-by-id after the fact.** Today the Langy manager holds an `apiKeyId`
  and can revoke that specific credential (`langyApiKey.ts:128-182`). A
  passport has no id to revoke. This is a real capability being deleted, and
  the reason it is acceptable is arithmetic: what made it necessary was a
  six-hour lifetime, and sixty seconds does not need a reaper.

What is *better* than today, and worth saying because the trade is not
one-way: revoking alice kills every passport minted for her, everywhere, at
once, with nobody enumerating credentials — as against killing the rows
somebody remembered to look up.

### 6. Renewal: how a sixty-second token survives a five-minute turn

Context #3(c). A worker holds its credential in a config slot for the life of a
turn. A ≤60s passport in that slot is dead before a slow turn's first tool
call.

```text
 CONTROL PLANE                     MANAGER (Go)                WORKER
 mint passport, exp = +60s ─push──► write into the worker's ──► reads it,
                                    mode-0700 config slot       calls the API
 t+30s  re-mint under the  ─push──► overwrite in place     ──►
        CURRENT epoch                                           each tool call
 t+60s  …                                                       picks up the
                                                                current file
 renewal FAILS (control plane       manager stops the turn
 unreachable, or the subject's      and says so, once
 grants no longer permit it)
```

Renewal is a **push over the channel that already carries the turn**, never a
credential-issuing endpoint the worker can call: ADR-123's containment
property — *the manager can revoke but cannot mint*
(`langyApiKey.ts:119-122`) — survives only if nothing downstream of the
control plane can ask for authority. The manager relays bytes; it signs none.

Renewal is also what makes a **coarse per-org epoch survivable for a held
credential.** §12's epoch is deliberately coarse: any grant write in the
organization invalidates every cached reading in it, which is free when the
consumer is a request about to re-collect anyway. For a credential held across
time it is not free — one unrelated grant write anywhere in `acme` would
otherwise kill every in-flight turn in the organization. Re-minting every 30
seconds turns that into a re-decide the customer never sees, and turns a
genuine revocation into a renewal that legitimately fails.

The cost, plainly: **a turn cannot outlive a 60-second control-plane outage.**
Today it survives up to six hours, because a stored key does not care whether
the control plane is up. That is an availability regression, and it is the
same trade as the revocation window — a credential that keeps working while
nothing can revoke it is precisely what a short `exp` exists to prevent. It
belongs in Consequences, not in a footnote.

*Alternative considered: a longer `exp` for the agent tier (15 minutes, the
gateway's number) and no renewal.* Simpler, and it matches the precedent. It
re-opens a fifteen-minute orphan window on the exact credential ADR-123 exists
to stop orphaning, and it makes "how long is a passport valid" a per-audience
question instead of a property of the format. One ceiling, one answer, and
renewal for anything that needs to outlive it.

### 7. Ship order: the one with a finding first

```text
 1  LANGY WORKER CREDENTIAL         ADR-123.  assert mode.
    needs: the passport subpath (mint + verify, TypeScript at both ends), the
    pair on AuthzPrincipal, the renewal push through the manager, and the
    worker reading a refreshed slot. NO Go verifier — the manager relays the
    token and the LangWatch API verifies it. Two Go surfaces still move (the
    credential envelope and the worker signature,
    services/langyagent/app/workerpool/pool.go); neither is a verifier.
    why first: the only item with a security finding behind it, and the only
    one where the passport DELETES machinery — the reaper, the system
    revocation path, the six-hour orphan window — rather than adding some.

 2  GO GATEWAY                      carry mode.
    needs: a Go verifier, and an authz-grant kind on the change feed the
    gateway already polls, so one cursor carries the authz epoch too. The
    cheapest second consumer BECAUSE it already speaks every part of this: a
    control-plane-signed HS256 token (gatewayJwt.ts), an org-scoped change
    feed (client.go:185-235), and an in-memory cache with soft and hard
    expiry (authresolver/service.go). The passport replaces a resolve call,
    not a design.

 3  COLLECTOR AND SHARE LINKS       carry mode.
    needs: nothing new in the format — but a share-token principal has no
    signed-in subject, which is the open question named below and is why this
    is third despite being the simplest.
```

**Where a Go verifier lives: `pkg/authzpassport`, not `services/aigateway/`.**
`pkg/jwtverify` set the precedent for exactly this — a crypto primitive shared
by whichever service needs it, reviewed in one place, with rotation modelled
once (`pkg/jwtverify/verifier.go:1`, consumed at
`services/aigateway/deps.go:121`). The passport verifier composes over it:
`jwtverify` does steps 1-3 of §4; `authzpassport` does 4-9 and owns the epoch
cursor and the bitset decode. Its internals are not designed here. What is
decided is that it is **one package, outside any service**, so that when the
collector or nlpgo needs one there is nothing to copy.

## Rationale / Trade-offs

**Why not widen the L1 cache to every process instead?** Because the processes
that need L2 cannot reach Postgres — that is the definition of the surfaces on
the list. A gateway node with a Prisma connection is a different architecture,
not a cheaper one.

**Why bitsets rather than a list of permission strings in the claim?** 16
bytes against roughly 1.5 KB for the same information, in a header, on every
request — and a bit test against a set membership over strings. The cost is the
append-only registry, and it is already paid: the rule is written, the full
order is pinned, and the pin's own comment says it exists for passports
(`registry.unit.test.ts:112-119`). Freezing the order was the cheapest thing
to promise *before* the first passport existed; this ADR is the moment that
promise starts being load-bearing rather than prospective.

**Why not role names in the claim, the way most systems do it?** A role name
means nothing without the role's definition, so a verifier holding one either
resolves it — a lookup, which is what we came here to delete — or caches role
definitions, which is a second invalidation problem with an epoch of its own.
The bitset is the resolved answer, and the registry index is the only shared
vocabulary either side needs.

**Why is `authority` signed rather than derived from the actor's kind?**
ADR-123 §1 argues it and this ADR takes it: `delegated` and `assumed` are
opposite semantics over identical data, so a verifier that infers it infers it
wrongly the first time a third kind of actor exists — silently, in the
direction of more access. Signing it means the edge that knew the reason is the
only thing that can state it.

**Why two modes rather than always carrying the answer, as §12 sketches?**
Because the one consumer with a live need requires both ceiling operands to
stay live (Context #3(b)), and a format that cannot express "identity only"
would force ADR-123 either to freeze the intersection or to invent a second
token. One format with two modes, each verifier accepting exactly one, is
smaller than two formats.

**What we are accepting.** A second signed-token format to mint, verify,
rotate and observe — the posture §12 already takes for passports generally. A
hard dependency of long-running agent turns on control-plane reachability
(§6). The permanent loss of revoke-one-bearer-by-id (§5). And a verify path
where a mistake is an authorization bypass rather than an outage, which is why
every refusal in §4 is written as its own branch and earns its own scenario,
rather than collapsing into one "verification failed".

## Consequences

- **Positive.** The stateless surfaces get an answer in ~2 µs with no database
  connection — what §12 promised and could not deliver without this. ADR-123
  becomes implementable: the actor stops being an unsigned JSON field beside
  an unrelated credential and becomes a signed claim, closing the
  confused-deputy shape our own code already names as a trap
  (`langyApiKeyIdentity.ts:47-56`). A revocation reaches every held credential
  in the organization at once, bounded by a number we choose, instead of
  reaching the credentials somebody enumerated. And the registry freeze stops
  being a promise about the future.
- **Negative.** A long-running agent turn now depends on the control plane
  being reachable every 30 seconds (§6), where a stored key did not. A second
  token format, in two languages, on a hot path, where every failure mode has
  to be a deliberate branch. `AUTHZ_PASSPORT_SECRET` becomes a real secret
  with a rotation obligation in both the TypeScript and the Go deployments.
  And the epoch, which so far has only ever cost us a redundant database read
  when it went wrong, becomes something a request can be refused for.
- **Neutral.** The gateway JWT is unchanged and keeps its 15-minute lifetime,
  its `revision` claim and its own secret; nothing about virtual-key traffic
  moves. `AUTHZ_EPOCH_CACHE` keeps its meaning — the L1 grants cache — and does
  not gate passports: a separate surface gets a separate lever. The
  browser-safe barrel does not gain a byte, because everything here sits
  behind `@langwatch/authz/passport`.

### What is NOT decided here

**Cross-language claim canonicalization.** A TypeScript and a Go verifier will
read the same token, and the details that make that exact — JSON key ordering
under signing, base64url padding on `prm`, integer width for `epo`, what
happens to an unrecognised claim — are a contract that deserves a shared
test-vector file rather than a paragraph. It is the first thing consumer 2
(§7) has to settle, and it should be settled with fixtures, not prose.

**Key rotation cadence.** The **mechanism** is decided and is not new: a `kid`
header from v1, and overlapping secrets verified current-then-previous, which
is what `pkg/jwtverify` already does for the gateway
(`verifier.go:36-40,:47-55`) and what `services/aigateway/deps.go:121-126`
already wires. How often, who turns the handle, and whether it is automated are
operational questions with no bearing on the format; answering them here would
put a runbook inside an ADR.

**Passports for anonymous and share-token principals.** Consumer 3. A share
link has no signed-in subject, and `AuthzPrincipalRef`'s `anonymous` case
deliberately carries no id (`packages/authz/src/types.ts:53-60`). What `sub`
holds for a share-token bearer — the token, the resource, or nothing — and
whether such a passport is minted per request or per link, interacts with
ADR-092 §8's possession-not-existence invariant and should be decided with
that section open, not inferred from this one.

**Whether the epoch stays per-organization.** §12's coarseness is deliberate
and this ADR inherits it, including the consequence in §6 that an unrelated
grant write invalidates every in-flight passport in the organization. If
renewal turns out to be too blunt an answer, a finer version key is the next
lever — and that is a change to ADR-092's epoch, not to this format, because
`epo` and `es` already carry whatever the counter turns out to be.

## References

- [ADR-092](092-unified-authorization-engine.md) §12 (the epoch ladder and the
  L2 sketch this makes buildable; its 2026-08-17 amendment on the projection
  cursor), §1 (the registry), §4 (`{actor, subject}`), §8 (the
  possession-not-existence invariant the share-link case must not break).
- [ADR-123](123-an-agent-session-is-a-principal.md) — the first consumer, the
  `{actor, subject, authority}` claims this signs, and the revoke-by-id trade
  it concedes.
- The precedent: `platform/app/src/server/gateway/gatewayJwt.ts` (15-minute
  HS256, dedicated secret, `revision` claim, `min(TTL, credential expiry)`);
  `pkg/jwtverify/verifier.go` (the shared Go verifier — rotation, and the
  pinned HMAC method at `:65-70`); `services/aigateway/deps.go:121-126` (how
  it is wired).
- The fan-out that already ships:
  `platform/app/src/server/gateway/changeEvent.repository.ts` (the monotonic
  per-org revision),
  `platform/app/src/server/routes/gateway-internal.ts:614-665` (the long-poll
  route), `services/aigateway/adapters/controlplane/client.go:185-235` and
  `services/aigateway/adapters/authresolver/service.go:84-88,:130-133` (the
  cursor, and the cache it invalidates).
- The epoch as built: `platform/app/src/server/app-layer/authz/epoch.ts` (the
  Redis `INCR`, and why a missing key is `null` and not 0);
  `packages/authz-server/src/authz.service.ts:450-490` (the L1 read and the
  absolute age ceiling this reuses);
  `platform/app/src/server/app-layer/authz/runtime.ts:57-63` (composition).
- The bitset and its freeze: `packages/authz/src/bitset.ts`;
  `packages/authz/src/registry.ts:20-24` and `:208-212`;
  `platform/app/src/server/app-layer/authz/__tests__/registry.unit.test.ts:99-119`
  (the sentinel indices and the full-order pin, whose comment names passports
  as the reason).
- Where it lands: `packages/authz/README.md:51-53` (the "no passport exists"
  note this ADR is the design behind), `:208` (the subpath rule), `:247-249`
  (the term entries), `:327-329` (`AUTHZ_PASSPORT_SECRET`), `:340-343` (the
  codecs behind the subpath); the shape it follows,
  `packages/authz/src/witness.ts:20-25`.
- The first consumer's boundary:
  `platform/app/src/server/app-layer/langy/langyApiKey.ts:119-122,:128-182,:202-224,:312-343`;
  `LangyCredentialService.ts` (`getOrProvision`); `langyApiKeyIdentity.ts:47-56`;
  `services/langyagent/transport/rpc/rpc.go:51`;
  `services/langyagent/adapters/opencode/provision.go:486-494`;
  `services/langyagent/app/workerpool/pool.go`.
- Spec: `specs/rbac/authz-passports.feature` (this ADR). Contracts it must not
  contradict: `specs/rbac/authz-epoch-cache.feature`,
  `specs/rbac/agent-principals.feature`,
  `specs/rbac/unified-authorization-engine.feature`.
- PR #7532 (the free-list wave that turned the L1 cache on).
