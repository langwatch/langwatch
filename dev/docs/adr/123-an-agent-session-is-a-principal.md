# ADR-123: An agent session is a principal, not a credential

**Date:** 2026-08-25

**Status:** Proposed (2026-08-25)

**Builds on:** [ADR-092](092-unified-authorization-engine.md) §4 (principals,
not bolt-ons — the `{actor, subject}` shape), §9 (the owner ceiling,
`effective(key) = grants(key) ∩ grants(owner)`, which shipped), §12 (the epoch
ladder and its L2 passport), and the "What falls out for free" entry *Agent
principals*, which this ADR implements. Nothing in ADR-092 is superseded.
[ADR-047](047-langy-foundations.md) §B (the caller-scoped Langy session key —
the decision that got the algebra right and the storage wrong; this keeps the
former and replaces the latter).
[ADR-045](045-domain-errors-handled-boundary.md) (handled errors, `fault`).

**Related:** PR #7532 (the wave that landed the other deferred free-list items
— the epoch cache, expiring grants, denial explanations; this is the next one),
issue #4977 (caller-scoped per-chat keys, which ADR-047 partially closed),
[ADR-033](033-langy-worker-network-isolation-under-gvisor.md) (worker
isolation — the process boundary this design has to cross),
[ADR-110](110-grant-aggregates-are-grants.md) (grant aggregates).

**Numbering:** 123 was chosen after checking three places, because one is never
enough. `dev/docs/adr/` on this worktree tops out at 116; `git log --all` over
`dev/docs/adr/*` across every ref in the repository tops out at 122; and the
open pull requests were read for in-flight numbers (#7531 carries 121 and 122,
#7529 amends 008, #7506 claims a third 101, #7532 carries no ADR). 117-122 are
in flight on the identity branches and have not merged, so this takes the first
number past them rather than filling a gap that is already spoken for.

## Context

### The ceiling already works. The credential is the problem.

Two things ADR-092 listed as future work are live code today, and it matters to
be exact about which:

- **The owner ceiling is implemented.** `AuthzEngine.decideWithCeiling`
  (`packages/authz/src/engine.ts:98-143`) decides twice — once against the
  key's grants, once against the owner's — and ANDs them. A permission the key
  holds and the owner does not comes back `allowed: false` with
  `denialReason: "owner-ceiling"`, and the matched binding is stripped so the
  refusal cannot leak the owner's grant (`engine.ts:136-142`).
  `AuthzService.checkDetailed` resolves the owner itself rather than taking it
  from a caller (`packages/authz-server/src/authz.service.ts:104-123`,
  `ownerGrantsFor` at `:387-421`), so no seam can forget to apply it.
- **Langy already runs on that ceiling.** ADR-047 §B replaced the shared
  admin-equivalent "Langy" service key with a per-chat `ApiKey` **owned by the
  requesting user**, carrying the intersection of a Langy permission policy
  with what that user actually holds at project scope
  (`mintLangySessionApiKey`,
  `platform/app/src/server/app-layer/langy/langyApiKey.ts:271-392`, the
  ownership line at `:377-378`). The entry point refuses outright for a
  credential with no owning user — *"Langy acts as a person, and the access
  decision is made per user"* (`langyApiKeyIdentity.ts:70-105`).

So the headline property of the free-list entry — *a Langy tool call can never
exceed the human who asked* — is not something this ADR introduces. It is
already true, and true **live** rather than as a snapshot: the ceiling re-reads
the owner's current bindings on every request
(`server/rbac/role-binding-resolver.ts:656-663`, engine path at `:692-699`;
the contract stated at
`server/app-layer/permissions/credential-decision.repository.ts:32-38`), so
demoting the user shrinks every session they started, on their next tool call,
with no rotation ceremony. **The instant-demotion property is inherited, not
invented, and this ADR must not claim credit for it.**

What is left is everything around it, and it is not small.

**1. The principal is a database row carrying a six-hour bearer token.** Every
Langy chat that spawns a worker writes an `ApiKey` (plus a restricted
permission array and a PROJECT-scoped `RoleBinding` with `role: "CUSTOM"` —
`langyApiKey.ts:381-385`) and hands its plaintext token to a worker process,
which keeps it in its environment for the life of the worker
(`services/langyagent/adapters/opencode/provision.go:486-494`).
`LANGY_SESSION_KEY_TTL_MS` is six hours (`langyApiKey.ts:55`). Because a reused
worker keeps the key it booted with, many of those rows are never used: the
service's own comment reports *"41 keys minted, 14 ever used"* on a dev box
(`LangyCredentialService.ts`, the `getOrProvision` docstring), and the
`mintSessionKey` seam exists to stop paying for the rest. That sprawl needs
machinery of its own — a name-and-tenant-gated system revocation path
(`langyApiKey.ts:128-182`), an expiry reaper (`:202-224`) whose docstring
explains it is *"not redundant with revoke-on-death"* because a SIGKILLed
manager runs no cleanup, and a counter for reaped keys as the tell that the
fast path broke. All of it exists to manage a credential we mint only because
there was no principal shape to mint instead.

**2. The agent's own half of the intersection is a 476-line source file, not a
role.** `langyPermissionPolicy.ts` partitions every resource family into "fully
excluded" (`:145-151` — `secrets`, `langy`, `ops`), "auth scope: readable,
never writable" (`:183-200`) and "full access", plus an action allowlist
(`:104-118` withholds `share`, `rotate`, `viewOtherPersonal`) and single-grain
exclusions (`:262-266`), and `langy-permission-coverage.unit.test.ts` fails CI
when a newly invented family lands in no bucket. The reasoning in that file is
good and this ADR keeps every word of it. What it is not is a **role**: it
cannot be read by the engine, cannot appear in `explain()`, cannot be shown on
the Access surface, cannot be diffed in a permission matrix, and cannot be
varied per agent. It is the agent's grant set, written where authorization
cannot see it.

**3. Nothing in the decision record knows an agent was involved.**
`AuthzDecision` carries exactly one principal
(`packages/authz/src/types.ts:156-166`); the owner consulted by the ceiling
appears only as the string `"owner-ceiling"` on a denial, and never on an
allow. Downstream, an `AuditLog` row has one `userId` and a metadata blob
(`prisma/schema.prisma`, `model AuditLog`), and the only impersonation
convention is `metadata.impersonatorId` written by the tRPC path
(`platform/app/src/server/api/trpc.ts:749-751`). The single place in the
codebase that distinguishes a Langy write from an ordinary integration is
`workbenchActorFrom`, on the experiments surface
(`platform/app/src/server/experiments/workbenchActor.ts:28`), and it does so by
comparing the key's *name* (`isLangySessionKey`,
`platform/app/src/server/api-key/token-resolver.ts:191`). Everywhere else, a
prompt Langy rewrote for alice is recorded as alice rewriting it. **"Langy did
X on behalf of alice" is not a fact this system stores.**

**4. Attribution and authority come from two unjoined sources.** The control
plane sends the Go manager a turn payload carrying both `actorUserId` — a plain
JSON field (`services/langyagent/transport/rpc/handlers.go:65,139`,
`transport/rpc/rpc.go:51`) — and the minted key inside `credentials`. The
manager authenticates the *caller* with a shared bearer secret
(`transport/rpc/http.go:111-121`) and then believes the asserted
`actorUserId`, which drives worker-pool signature, worker reuse and OTel
attribution (`app/workerpool/pool.go:474,782`,
`adapters/otelrelay/otelrelay.go:494-495`, where it is stamped as
`end_user.id`). Authority, meanwhile, comes only from the key. Our own code
names this as a trap: the doc comment on `resolveLangyKeyIdentity` says the
identity there is derived from the credential *"and never a value taken from
the request body, which is the trap the internal relay plane fell into"*
(`langyApiKeyIdentity.ts:47-56`). It is contained today — the manager can
revoke but cannot mint (`langyApiKey.ts:119-122`) — but two sources for one
identity is the confused-deputy shape in miniature, and it exists because the
identity is not part of the credential.

**5. The denial-explanation surface cannot explain an agent denial.**
`explainDenial` hard-codes `principal: { type: "user", id: userId }`
(`platform/app/src/server/app-layer/authz/denial-explanation.ts:157`) and runs
only for `no-binding` on a real user. The operator-facing walk has the mirror
gap: `AuthzEngine.explain` (`engine.ts:169-214`) has no branch for
`owner-ceiling`, so a ceiling denial renders each of the subject's bindings as
"does not grant X" — true of the row, false of the reason — and prints
`denial reason: owner-ceiling` underneath. PR #7532 has just made denials say
why. Agent denials are outside what it can say why about.

**6. The intersection bounds platform permissions, and the agent carries
credentials that are not platform permissions.** This is the one that is not
tidy. A turn's credential bundle also contains a **GitHub App installation
token minted at organization scope with no user check at all**:
`mintTurnToken({ organizationId })`
(`LangyCredentialService.ts:424-436` →
`server/app-layer/github/github-installations.service.ts:454-470`). The
invoking user's identity survives only as cosmetic attribution — the
`Co-authored-by` login derived from their LangWatch profile
(`resolveActingGithubLogin`). A user with no GitHub access whatever in the
organization can drive `git` and `gh` at full installation authority through
Langy; the limiters are a per-day PR cap and a feature flag, not the ceiling.
The per-project LLM virtual key is a milder instance of the same shape — shared
by every chat in the project, deliberately, because cost attribution is
per-project. **The ceiling is a statement about the platform's own permission
vocabulary, and a principal shape does not make an unbounded third-party token
bounded.** Naming this here is the point; fixing it is not in this ADR's scope
(see "What this does NOT cover").

### The constraint the design has to resolve

The obvious reading of "ephemeral principal, minted at the identity edge, never
stored" is that nothing crosses a wire. That is not available here, and
pretending otherwise would produce an ADR that cannot be implemented.

A Langy turn does not execute in the request that started it. It executes in a
separate, isolated, per-conversation worker process (a distinct UID, mode-0700
config, `services/langyagent/app/workerpool/uid.go:14-29`) managed by a Go
service, and that worker's only LangWatch transport is the `langwatch` CLI
authenticating with the key in its environment
(`adapters/opencode/provision.go:486-494`). **Something bearer-shaped must
cross that boundary.** The stored `ApiKey` is not there because anyone wanted a
row; it is there because a row was the only thing we had that a worker could
present.

So the design cannot be "no token". It has to be "a token that *is* the
principal" — self-describing, verifiable without a lookup, and short enough
that its existence is not an outstanding grant. ADR-092 §12 already specifies
that object as the L2 rung of the epoch ladder: a signed passport carrying
`{ principal, scope, epoch, exp }`, verified by HMAC plus an in-memory epoch
compare, no database and no connection. It was designed for the collector and
the Go gateway. An agent session is the same problem.

## Decision

### 1. A principal is a pair, and the pair says how the actor counts

`AuthzPrincipalRef` today is one identity —
`{ type: "user" | "apiKey", id } | { type: "anonymous" }`
(`packages/authz/src/types.ts:53-60`, over `CALLER_KINDS` at
`vocabulary.ts:95-101`). It becomes a pair, with the single-identity case
written as the pair whose halves are equal:

```text
 AuthzPrincipal = {
   subject:   AuthzPrincipalRef      whose grants are being resolved
   actor:     AuthzActorRef          who is making the request
   authority: "own" | "delegated" | "assumed"
 }

 own        actor === subject. Every request today. Nothing changes.
 delegated  the actor CAPS the subject:  effective = grants(subject) ∩ grants(actor)
            an agent session. The actor is a role, not a person.
 assumed    the actor RECORDS, does not resolve: effective = grants(subject)
            platform-ops impersonation (ADR-092 §4). Out of scope here; the
            pair is shaped to hold it so it is not a second mechanism later.
```

`authority` is not decoration. ADR-092 §4 gives the `{actor, subject}` shape
but not the direction — an actor who caps and an actor who merely signs the
record are opposite semantics over identical data, and a field that has to be
inferred from the actor's *kind* will be inferred wrongly the first time a
third kind appears. It is declared at the edge, where the reason for the pair
is known, and it is part of what the passport signs.

### 2. The algebra: the agent role and the invoking human, both live

```text
 grants(role of agent:langy)       grants(alice, right now)      effective(session)
 one role, all sessions            her bindings, walked live
 ┌────────────────────────────┐   ┌────────────────────────────┐   ┌──────────────────┐
 │ prompts:manage             │   │ prompts:manage             │   │ prompts:manage   │
 │ datasets:manage            │ ∩ │ datasets:manage            │ = │ datasets:manage  │
 │ traces:view                │   │ traces:view                │   │ traces:view      │
 │                            │   │ traces:share               │   │                  │
 │  ✗ traces:share            │   │ organization:manage        │   │                  │
 │  ✗ organization:manage     │   │ secrets:view               │   │                  │
 │  ✗ secrets:view            │   │                            │   │                  │
 └────────────────────────────┘   └────────────────────────────┘   └──────────────────┘
        ▲                                   ▲
        │ withheld from EVERY agent          │ alice is demoted at 14:03
        │ session, whoever asks. Widening    │ → the check at 14:03:01 collects her
        │ this widens the CEILING, never     │   bindings again and the session
        │ anybody's access.                  │   shrinks with her. No rotation,
        │                                    │   no revocation, no key to find.
```

The right-hand column is what the owner ceiling already gives us; the left-hand
column is `langyPermissionPolicy.ts` moved somewhere the engine can read it.
Nothing about the intersection is new mathematics — it is `decideWithCeiling`
with its second operand supplied by a role instead of by an `ApiKey.userId`
lookup, which is why this is a free-list item and not a project.

**Both operands are collected live.** The agent's role is a role like any
other, cached under the org's epoch (ADR-092 §12) and re-collected when it
moves. The subject's grants are collected the same way. There is no mint-time
snapshot of the intersection — which is the second thing the stored key gets
wrong: today the held subset is computed once, at mint
(`langyApiKey.ts:312-343`), and the live ceiling only rescues it in the
shrinking direction.

**So an agent session tracks the subject in *both* directions, and that is a
deliberate departure from ADR-092 §9's asymmetry.** §9 makes a *scoped* API key
shrink with a demoted owner but never grow with a promoted one, because the key
was minted with a declared, narrower intent that a promotion must not silently
widen. An agent session has no such intent to preserve: nobody chose its
permission set, and what it means is "the agent, acting as whoever asked,
within what the agent may ever hold". That is §9's **mirror** shape, where the
subject is the only limiting term and the credential grows with them. Promoting
alice mid-conversation therefore lets the agent do the newly granted thing on
her next request, and she does not have to start a new conversation. Today she
does — the held subset is frozen at mint — and that is a bug people work around
by reloading, not a safety property anyone chose.

### 3. Vocabulary: one new caller kind, one new role, and no new grant subject

The repository has two principal enumerations and they are not the same set:

- `PRINCIPAL_KINDS` (`packages/authz/src/vocabulary.ts:76-87`) — what a grant
  can be **bound to**: `user`, `apiKey`, `group`, `team`, `project`,
  `organization`, `anyone`.
- `CALLER_KINDS` (`vocabulary.ts:95-101`) — what can **make a request**:
  `user`, `apiKey`, `anonymous`.

**An agent session gets a caller kind and never a grant-subject kind.** Adding
`agent` to `PRINCIPAL_KINDS` would make an agent session a thing a grant can
name, and that means rows: a grant per session, an offboarding sweep that has
to enumerate them, a dormant-binding detector that has to know they are
supposed to be dormant, and a new class of orphan when a turn dies. The whole
point of the composition is that the session holds nothing of its own. ADR-092's
free-list entry says *ephemeral*, and this is the concrete reason it is right.

What does get storage is exactly one thing per agent kind, never per session:

```text
 STORED (one row, forever)          EPHEMERAL (per turn, never stored)
 ┌───────────────────────────┐      ┌────────────────────────────────────────┐
 │ Role "langy-assistant"    │      │ AuthzPrincipal {                       │
 │  permissions: the policy  │      │   subject:   user alice                │
 │   in langyPermissionPolicy│      │   actor:     agent langy               │
 │   expressed as a role     │      │   authority: delegated                 │
 │  kind: system_agent       │      │ }                                      │
 └───────────────────────────┘      │ + scope, epoch, exp — signed, not saved│
   visible in explain(), on the     └────────────────────────────────────────┘
   Access surface, in the matrix
   codegen, diffable in a PR
```

`langyPermissionPolicy.ts` is not deleted and its comments are not paraphrased.
It becomes the **generator** of that role's permission set, exactly as it
already generates `LANGY_CANDIDATE_PERMISSIONS` via
`langyCandidatePermissions()`. The totality check that fails CI when a new
resource family is unclassified survives verbatim and gains a second reader:
the role's permission set is validated against the registry like any other
role's, so a family the policy classifies and the registry does not know about
becomes two failures instead of one.

The reasoning also survives a test it does not face today. As a role, "`secrets`
is never readable" and "the auth scope is read-only" are statements a reviewer
sees in a diff of a permission matrix, rather than statements buried in a source
file that one code path reads.

### 4. Minting: a passport, not a row

```text
 alice types in the Langy panel
        │
        ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ IDENTITY EDGE  (the turn route — where the key is minted today)        │
 │   subject   = the authenticated session's user   (never the payload)   │
 │   actor     = agent:langy                                              │
 │   authority = delegated                                                │
 │   scope     = project chatbot                                          │
 │   epoch     = the org's current projection cursor          (§12)       │
 │   exp       = min(turn budget, the subject's session expiry)           │
 │        ──→  sign  ⇒  the passport                                      │
 │   NO ApiKey row. NO CustomRole row. NO RoleBinding row. Nothing to     │
 │   revoke, nothing to reap, nothing left behind when the turn dies.     │
 └────────────────────────────────────────────────────────────────────────┘
        │  travels with the turn: control plane → manager → worker, in the
        │  same env slot the key occupies today. It is then the ONLY thing on
        │  that wire naming the actor — which closes the split in Context #4:
        │  `actorUserId` stops being an independently-asserted payload field
        │  and becomes a signed claim.
        ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ TOOL CALL   POST /api/prompts    Authorization: <passport>             │
 │      │                                                                 │
 │      ▼   authz.check({ principal, permission, scope })                 │
 │   verify HMAC, compare epoch                    ~2 µs, zero queries    │
 │   collect grants(alice)                         live, epoch-cached     │
 │   collect grants(role of agent:langy)           live, epoch-cached     │
 │   decide both · AND them                        the §9 algebra         │
 │      │                                                                 │
 │      ├── allowed → ONE AuthzDecision { actor, subject, authority, … }  │
 │      └── denied  → which wall? (§5)                                    │
 └────────────────────────────────────────────────────────────────────────┘
```

The passport is ADR-092 §12's L2 object with the pair in its claims. Its
verification cost is why this is affordable per *turn* rather than per session:
today's mint is a Postgres write inside an interactive transaction on the
critical path of a chat POST, and the reason it is paid only once per worker is
an optimisation that exists precisely because it is expensive. A passport is
cheap enough to mint per turn, which is what makes "the session holds nothing"
practical rather than aspirational.

**Revocation changes shape, and that is a real trade, not a free win.** Today
the agent manager holds an `apiKeyId` and can kill a specific credential when a
worker dies. A passport has no id to kill. Three things replace it, and they
are not equivalent:

- **Expiry does most of the work.** A turn-scoped `exp` measured in minutes
  makes the six-hour orphan window — and therefore the reaper — go away by
  construction.
- **The epoch kills a class, immediately.** Any grant write in the org, an
  offboard, or a membership disable advances the cursor, and every passport
  minted under the old epoch stops verifying. This is strictly better than
  today for the case that matters: revoking alice kills her agent sessions
  everywhere at once, rather than killing the keys someone remembered to look
  up.
- **What is genuinely lost** is "kill this one session and no other" without a
  grant change — an operator stopping one runaway turn. If that turns out to be
  needed, it is a per-conversation nonce checked alongside the epoch, and it is
  the one piece of session-shaped state we would then store. We are not
  building it now, and should not, until something asks.

### 5. Denials say which wall, and `api_key_permission_not_delegable` becomes a case of the rule

```text
 a tool call is refused. WHICH wall?

 1  agent-ceiling            the agent's role withholds it, whoever asks
                             → "Langy is never granted traces:share. Make this
                                change in LangWatch yourself."
                             → never "ask an admin": no grant fixes this
                             ← this is today's api_key_permission_not_delegable

 2  the subject's own denial  no-binding · no-membership · membership-disabled
                             · lite-member-restricted
                             → PR #7532's explanation, computed for ALICE:
                               the roles she holds, the roles that would grant

 3  agent-role-missing       the agent's role does not resolve at all
                             → deny · fault: platform · log loudly · say
                               nothing to the customer about widening anything

 4  subject-session-expired  alice's session ended while the turn ran (§7)
                             → stop the turn and ask her to sign in, once

 PRECEDENCE: 1 before 2. When NEITHER side holds the permission, the answer is
 the agent ceiling, because it is the one the customer cannot act on by asking.
```

Today's `api_key_permission_not_delegable` is **not an authorization control**,
and the ADR is not pretending to promote one. It fires strictly *after* the
ceiling has already denied the request — `if (!allowed)
refuseApiKeyCeiling(...)` at
`platform/app/src/server/api-key/auth-middleware.ts:687` — and its only job is
to relabel that denial so the remediation copy is honest
(`:690-736`, the discriminator at `:633-643`). It exists because of a real
incident: Langy read a generic 403 for `triggers:create`, told the user it
would retry once they "granted the permission", and the permission was one no
role could ever hold (`server/api-key/errors.ts:85-103`).

Three things about that shape are special-casing rather than design. The
credential is identified by a **name string** (`isLangySessionKey` is
`apiKey.name === "Langy session"`, `token-resolver.ts:191`). The policy is
consulted from the API-key middleware rather than from the engine, and the
subject `"Langy"` is hard-coded at the throw site. And the branch is reachable
only on the Hono API-key path, so any other surface answers the same situation
with the wrong advice.

Under the pair, the engine has already collected the actor's grants in order to
intersect them, so it already knows which operand failed. `agent-ceiling`
becomes a `denialReason` alongside the five in
`packages/authz/src/types.ts:142-147`; the customer-facing copy stays exactly
what it is today (`api_key_permission_not_delegable` in
`features/errors/logic/presentation.ts` and its remediation in
`server/app-layer/error-remediation.ts` keep their code and their words — the
wire contract does not move); and every surface gets it, not only the one that
happened to have the branch.

Two explanation gaps close as part of this, because shipping a denial reason
nothing can render is how we got here:

- `AuthzEngine.explain` grows the branch it lacks, for `owner-ceiling` and
  `agent-ceiling` both: a ceiling denial must say *the ceiling refused it*, not
  list the subject's bindings as if each fell short.
- `explainDenial` stops hard-coding a user principal
  (`denial-explanation.ts:157`) and takes the **subject** of the pair. For a
  delegated principal that is the invoking human — exactly whose roles the
  explanation is about — so the customer-facing sentence keeps working, and
  keeps being about them, when an agent asked on their behalf.

### 6. The audit trail records both, as a fact

```text
 today                                    with the pair
 ┌───────────────────────────────┐        ┌────────────────────────────────────┐
 │ AuditLog                      │        │ AuditLog                           │
 │   userId    alice             │        │   userId    alice       ← subject  │
 │   action    prompt.update     │        │   actor     agent:langy ← actor    │
 │   metadata  { … }             │        │   action    prompt.update          │
 └───────────────────────────────┘        └────────────────────────────────────┘
   reads: "alice updated it"                reads: "Langy updated it for alice"

 and the same pair rides every AuthzDecision (ADR-092 step 6, RECORD), so
 "everything an agent did for alice last week" is one query over the decision
 stream, not a join against a key id that was reaped three days ago
```

`AuthzDecision` gains `actor` and `authority` alongside its existing
`principal`, which is renamed to `subject` in the same change so the two halves
cannot be confused by position. The write-attribution vocabulary in
`@langwatch/actor` (`packages/actor/src/index.ts:43-52`, where an `Actor`
carries an optional flat `impersonatorId`) converges on the same pair rather
than keeping a second, differently-shaped answer to the same question.

This is the part with no workaround. Everything else here makes existing
behaviour cheaper or clearer; this records something currently recorded
nowhere, and it is what a customer asks for the moment an agent writes to their
data.

### 7. Failure modes, decided rather than discovered

**The invoking user's session expires mid-run.** Today the agent's authority
outlives the session that created it by up to six hours, and nothing
revalidates: `resolveLangyActorSession` builds the acting session with
`expires` set to *now*, with the comment that *"nothing downstream renews or
revalidates it"* (`langyApiKeyActorSession.ts`). Grants are not session-scoped,
so the owner ceiling does not catch this — a signed-out user still holds every
binding they held. **Decided:** the passport's `exp` is the minimum of the turn
budget and the subject's session expiry. A person who has gone home did not ask
for anything, and an agent whose whole premise is *acting for someone who
asked* should not outlive the asking. The cost is stated in Consequences: a
long-running turn dies when the session does, and work that should survive that
is the autonomous case, which this ADR does not cover.

**The agent's role is missing or does not resolve.** Deny every permission,
with `denialReason: "agent-role-missing"` and `fault: "platform"` (ADR-045).
Not customer-actionable: the copy must not suggest widening a role or asking an
admin, because neither helps and both send someone to a door that does not open
— the exact failure `ApiKeyPermissionNotDelegableError` was written to stop.
Note this is a *new* failure mode that today's shape cannot have, because today
the agent's half is compiled code that cannot be absent. Trading a compile-time
guarantee for a row is a real cost of §3 and is listed as one.

**A tool call needs a permission neither side holds.** Rung 1 wins (§5). The
customer is told the agent is never granted it, because that is the sentence
that stops them waiting for a grant nobody can make.

**The subject holds nothing the agent can use.** Today this refuses the chat
outright — `LangySessionKeyScopeError`, surfaced as an actionable refusal,
because an empty held subset means there is no non-empty key to mint
(`langyApiKey.ts:345-350`). A passport has no such constraint: an empty
intersection is a well-formed principal that will be denied at every tool call.
**Decided:** keep refusing at the edge. A chat that can do nothing is worse
than a refusal that says so, and `specs/langy/langy-session-key.feature` already
specifies what customers see.

**Redis is down.** The epoch cache degrades exactly as ADR-092 §12 specifies
for every other principal; an agent session gets no special path. Worth stating
only because "mint a credential" and "verify a claim" have different
dependencies, and the passport's is the smaller one.

## Rationale / Trade-offs

**Why not keep the minted key and just add the actor to the audit row?** That
is the smallest change and it was seriously considered. It closes Context #3
and nothing else: the sprawl, the reaper, the six-hour orphan window, the
policy-that-is-not-a-role, the split between asserted `actorUserId` and
credential-derived authority, and the unexplainable denial all survive. It also
entrenches what causes them — that an agent session is represented by a
credential, so every property we want has to be bolted to a credential.

**Why not a `PRINCIPAL_KINDS` member and real rows?** Because rows are grants,
and a grant outlives the request unless something deletes it. Every stored
representation of a session we have built has needed a reaper, and the one we
have needs two cleanup paths plus a metric to tell us when the fast one breaks.
Argued at length in §3.

**Why a role for the agent rather than calling `classifyForLangy` from the
engine?** Calling the policy function would work and would be less code. It
would also leave the agent's half invisible to `explain()`, to the Access
surface, to the matrix codegen, and to any second agent — and "which permissions
can the assistant ever hold?" is a question customers and auditors ask, so it
deserves the same answer shape as every other role. The trade is the new
failure mode in §7.

**Why `authority` as an explicit field rather than inferred from the actor's
kind?** Because `delegated` and `assumed` are opposite semantics over identical
data. The inference is correct right up until the third kind of actor exists,
and when it fails it fails silently, in the direction of more access.

**What we are accepting.** A new signed-token verifier on the hot path that must
be built and observed before it is trusted — the same posture ADR-092 §12 takes
for passports generally. The loss of revoke-one-session-by-id, replaced by
short expiry plus epoch (§4). A new deny-closed failure mode when the agent's
role does not resolve (§7). And the migration of a live, correct security
control: ADR-047's key is not broken, and rewriting a correct control is a
chance to make it less correct. The mitigation is that the algebra does not
change at all — only where each operand comes from — and
`specs/langy/langy-session-key.feature` must continue to bind unchanged through
the move. A scenario that stops binding during this work is a regression, not a
cleanup.

## Consequences

- **Positive.** The instant-demotion property stops depending on a credential
  being owned by the right person and becomes a property of the principal
  shape. "Langy did X on behalf of alice" becomes a stored fact, on the
  decision stream and on the audit row. `api_key_permission_not_delegable`
  stops being a name-matched relabel on one middleware and becomes a denial
  reason every surface produces, with an explanation behind it. The credential
  sprawl, the reaper, the system-revocation path and the six-hour orphan window
  are deleted rather than managed. The internal relay plane stops carrying an
  independently-asserted `actorUserId` beside an unrelated credential.
  `langyPermissionPolicy.ts`'s reasoning becomes reviewable in a permission
  matrix instead of a source file only one path reads.
- **Negative.** A second token format to mint, verify and observe. One new
  fail-closed mode (§7) where today there is a compile-time guarantee. The loss
  of single-session revocation by id. The migration of a security control that
  currently works. And two Go surfaces move with the TypeScript ones — the
  manager's credential envelope and the worker signature both name the key
  today (`services/langyagent/app/workerpool/pool.go`), so this is not a
  TypeScript-only change and must not be planned as one.
- **Neutral.** Langy's LLM virtual key is untouched: a per-project egress and
  cost-attribution credential, not a principal. The Langy access gate
  (`hasLangyAccess`, a per-user cohort flag,
  `server/app-layer/langy/langyAccessGate.ts:29-44`) is unchanged and still
  runs first. Worker isolation (ADR-033: per-worker UID, mode-0700 config) is
  unchanged, and remains what stops one worker reading another's token
  whatever that token's shape. Public REST names and the
  `api_key_permission_not_delegable` wire code are customer contracts and do
  not move.

### What this does NOT cover

**Autonomous and scheduled agents — agents with no invoking human.** An
automation that runs an agent on a trigger, a nightly job, a webhook-driven
run: there is no subject, so there is no intersection, and every argument above
about the ceiling evaporates. This is a genuinely different principal and it is
**an open question**, not an oversight.

The candidate answer is a **service principal with its own explicit bindings** —
`authority: "own"`, an actor that is the agent's role, and grants some human
deliberately attached at some scope. Two things make that harder than it sounds
and are why it is not decided here. First, a service principal has no ceiling at
all today: `ownerGrantsFor` returns `null` for an owner-less key and the engine
reads that as "decide alone" (`authz.service.ts:387-421`, pinned by
`owner-ceiling.unit.test.ts`). Second, ADR-092 §9 already flags the adjacent
escape — service keys with zero bindings defaulting to org-wide ADMIN — as one
the engine closes by requiring explicit bindings at creation. So an autonomous
agent principal has to arrive *with* its bindings and a named human accountable
for them, and designing that accountability is the work. Until it is done, an
agent with no invoking user stays out of scope and keeps using an
explicitly-bound service credential.

**Credentials the agent carries that are not platform permissions.** Context #6:
the org-scoped GitHub installation token is minted with no user check, and this
ADR does not change that. The principal shape makes the *platform* half exact
and leaves the third-party half exactly where it is. Bounding it needs its own
decision — plausibly a per-user GitHub identity, plausibly a narrower
installation scope, plausibly an explicit `github:*` grain in the registry that
the intersection can then bound — and that decision should be made on its own
evidence, not smuggled in here.

**Which human is the subject when a conversation has more than one.** Langy
conversations are owner-or-shared (`langy-conversation.service.ts:379-380`),
and the UI-action claim path checks `projectId` and `conversationId` but not
`pending.userId` (`ui-actions/ui-action.service.ts:402-418`), so on a shared
conversation a different member can win the claim for an action another member's
turn dispatched. Under the pair that becomes a precise question — whose grants
are the ceiling for a turn on a shared thread? — with no answer yet. Today a
turn has exactly one subject and this ADR keeps that; the shared-thread case is
named here so it is not discovered later.

Also not covered: agent-to-agent delegation, where the subject of one pair is
the actor of another and the intersections would need to compose; and
platform-ops impersonation, for which this makes room (`authority: "assumed"`)
but whose behaviour stays exactly where ADR-092 §4 left it —
`specs/rbac/unified-authorization-engine.feature` still carries the unbound
scenario "An impersonated request records both identities".

## References

- [ADR-092](092-unified-authorization-engine.md) §4 (the `{actor, subject}`
  shape), §9 (the owner ceiling), §12 (the epoch ladder and the L2 passport),
  and the "What falls out for free" entry *Agent principals*.
- [ADR-047](047-langy-foundations.md) §B — the caller-scoped per-session key
  whose storage this replaces and whose algebra it keeps.
- The ceiling as implemented: `packages/authz/src/engine.ts:98-143`
  (`decideWithCeiling`), `packages/authz-server/src/authz.service.ts:104-123`
  and `:387-421` (`ownerGrantsFor`),
  `packages/authz-server/src/__tests__/owner-ceiling.unit.test.ts`; the app-side
  path `server/app-layer/permissions/credential-decision.repository.ts:32-38`
  and `server/rbac/role-binding-resolver.ts:618-702`.
- The vocabulary this extends: `packages/authz/src/vocabulary.ts:76-87` and
  `:95-101` (`PRINCIPAL_KINDS`, `CALLER_KINDS`), `packages/authz/src/types.ts:53-60`
  (`AuthzPrincipalRef`), `:142-147` (`AuthzDenialReason`), `:156-166`
  (`AuthzDecision`); `packages/actor/src/index.ts:43-52` (write attribution).
- Langy as it runs today:
  `platform/app/src/server/app-layer/langy/langyApiKey.ts`,
  `langyPermissionPolicy.ts`, `LangyCredentialService.ts`,
  `langyApiKeyIdentity.ts`, `langyApiKeyActorSession.ts`, `langyAccessGate.ts`,
  and `__tests__/langy-permission-coverage.unit.test.ts`.
- Today's partial guard:
  `platform/app/src/server/api-key/auth-middleware.ts:633-643` and `:687-736`,
  `platform/app/src/server/api-key/errors.ts:85-125`
  (`ApiKeyPermissionNotDelegableError`),
  `platform/app/src/features/errors/logic/codes.ts:33`,
  `platform/app/src/features/errors/logic/presentation.ts:652`,
  `platform/app/src/server/app-layer/error-remediation.ts:223`.
- The explanation surfaces this must reach:
  `packages/authz/src/engine.ts:169-214` (`explain`),
  `platform/app/src/server/app-layer/authz/denial-explanation.ts:157`.
- The process boundary: `services/langyagent/transport/rpc/handlers.go:65,139`,
  `transport/rpc/rpc.go:51`, `transport/rpc/http.go:111-121`,
  `app/workerpool/pool.go:474,782`, `app/workerpool/uid.go:14-29`,
  `adapters/opencode/provision.go:486-494`.
- The unbounded third-party credential (Context #6):
  `platform/app/src/server/app-layer/langy/LangyCredentialService.ts:424-436`,
  `platform/app/src/server/app-layer/github/github-installations.service.ts:454-470`.
- Spec: `specs/rbac/agent-principals.feature` (this ADR). Existing contracts it
  must not contradict: `specs/langy/langy-session-key.feature`,
  `specs/langy/langy-session-key-lifecycle.feature`,
  `specs/langy/langy-tool-call-identity.feature`,
  `specs/rbac/denial-explanations.feature`,
  `specs/rbac/unified-authorization-engine.feature`.
- Issue #4977 (caller-scoped per-chat keys); PR #7532 (the free-list wave).
