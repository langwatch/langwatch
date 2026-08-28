# ADR-123: A domain is proved by a record that stays published

**Date:** 2026-08-25

**Status:** Accepted — Wave 3, implemented alongside D05's remainder

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverable
`D05-self-serve-onboarding.md` (the tiers this rewrites the third of).

**Builds on:** ADR-101 (the identity pipeline and what its events may carry),
ADR-110 (facts state themselves; a projection is rebuildable truth),
ADR-117 §5 (the connection aggregate, its lifecycle and its guards).

## Context

D05 shipped three onboarding tiers. The third — a hosted organization setting
single sign-on up itself — had a queue in the middle of it: an administrator
claimed a domain, a LangWatch operator approved the claim by hand, and only
then was the customer given a TXT record to publish. Two things about that
turned out to be wrong, in opposite directions.

**The queue decided nothing.** An operator looking at "acme wants acme.com"
has no information the platform does not. They cannot tell whether the person
asking works at Acme; the only thing that could tell them is the very DNS
record the customer is about to publish. So the review was a delay dressed as
a control — the epic's Open Q2 ("who staffs this queue and how fast") had no
good answer because there was no good answer to be had. Every comparable
product treats the published record as the evidence and has nobody in the
loop, and they are right to.

**And nothing was ever re-read.** A record published once proved a domain
forever. An administrator who deleted it in a spring clean kept vouching for
whoever asked; so did a company that let the domain lapse and somebody else
bought it. Between those two facts, the design managed to be both slower than
necessary and weaker than it looked.

Removing the operator is not free, and the cost is not where it first appears.
The review was never a real ownership check, but it *was* the place a human
noticed two other things: that `gmail.com` is not a company, and that this
organization is on its four-hundredth domain today. Those have to become rules
before the human goes, or removing them is a downgrade.

There is also one question a DNS record genuinely cannot answer: two
organizations claiming the same domain. Both cannot control it, but which one
does is a dispute about who a company is, and that needs a person.

## Decision

### 1. A published record is a claim-approval authority

The connection aggregate has recorded WHAT authorized a domain claim since
D05: `platform-operator` or `license`. A third value joins them, `dns-proof`,
and it means what it says — the record on the domain authorized the claim.

It is the only authority a caller may never assert. `approveDomainClaim`
refuses a command that names it (`sso_connection_invalid_transition`); the
only thing that may state it is `verifyDomain`, in the same commit as the
proof it rests on. A `dns-proof` approval that no landed proof supports is
therefore not merely unlikely — it is unreachable.

The approval is stated AFTER the proof, and this is the honesty of the whole
design:

```
  claim_domain            →  CLAIMED, claim WAITING, nothing approved
  request_verification    →  VERIFICATION_PENDING (allowed from CLAIMED now)
  verify_domain           →  ┌ domain_claim_approved  authority=dns-proof
                             └ domain_verified        method=dns-txt
                               ── one command, one commit, in that order ──
```

Two facts from one command, approval first, atomically. No reachable state has
a domain approved before something proved it, and an uncontested history
contains no operator command anywhere.

### 2. The operator queue is disputes only

`disputedDomainClaimQueue` lists exactly the waiting claims on a domain some
OTHER organization has already proved. Everything else left a person's desk
when the record became the decision — listing a claim whose next move is the
customer publishing DNS is listing work nobody has to do, and burying the one
entry that IS work under a hundred that are not is how a queue stops being
read.

### 3. Abuse rails replace the eye that was watching

Two, both in the guard rather than on the surface, because there is no longer
a person between a claim and a domain routing sign-ins:

- **`isClaimableSsoDomain`** refuses a consumer mail provider, a registry
  suffix, and any single-label domain, with `sso_domain_not_eligible`. A record
  published at `_langwatch-verification.com` would be genuine evidence that
  somebody controls a registry, which is precisely the claim we must not
  honour.
- **A per-connection window** — five distinct domains an hour — refuses the
  rest with `sso_domain_claim_throttled` and the wait attached. Counted from
  the claims the ledger already holds rather than a counter of our own: it is
  derived from the facts a dispute is answered from, it survives a restart,
  and there is no second store to fall open.

### 4. The record is read again, and the state is on the EVIDENCE

Three times a day, every domain a published record proved is re-read. What
that produces is a state on the proof, never on the connection:

```
                      record absent
      ┌──────────┐ ───────────────────► ┌──────────┐
      │ VERIFIED │                      │ WAVERING │
      │          │ ◄─────────────────── │          │
      └──────────┘   record published    └──────────┘
            ▲                                 │
            │                                 │ still absent
            │        record published         │ after 48h
            │                                 ▼
            │                            ┌──────────┐
            └─────────────────────────── │  LAPSED  │
                                         └──────────┘

   VERIFIED  vouches for new people, routes, everything normal
   WAVERING  vouches for new people, routes — an ALERT and a clock, nothing else
   LAPSED    routes, existing members unaffected — stops vouching for new people
```

`SSO_DNS_REPROOF_GRACE_MS` is forty-eight hours: long enough to survive a DNS
migration done over a weekend, short enough that a domain somebody else now
owns cannot quietly admit strangers for a week.

The events, and the commands that produce them:

```
   sweep reads DNS
        │
        ├── published & matches hash ──► record_domain_proof_present
        │                                     │
        │                                     ├─ was VERIFIED → (no fact)
        │                                     └─ was WAVERING
        │                                        or LAPSED   → domain_proof_recovered
        │
        ├── absent (or a stranger's record) ─► record_domain_proof_absent
        │                                     │
        │                                     ├─ was VERIFIED → domain_proof_wavered
        │                                     │                 (+ email admins)
        │                                     ├─ WAVERING, before deadline → (no fact)
        │                                     ├─ WAVERING, past deadline
        │                                     │                → domain_proof_lapsed
        │                                     │                  (+ email admins)
        │                                     └─ was LAPSED   → (no fact)
        │
        └── unreachable ──────────────────► NO COMMAND AT ALL
```

Three properties are structural rather than a branch somebody could later
delete:

- **A lookup that failed commands nothing.** `unreachable` has no verb. Our
  resolver timing out says nothing about the customer's DNS, so it starts no
  clock and advances none. An outage of ours never spends a customer's grace.
- **A check that changes nothing states nothing.** A healthy connection swept
  three times a day writes exactly zero events, forever. Only a transition is
  a fact.
- **Only records are re-read.** An attested domain, a licence-proved one and a
  grandfathered one have no TXT record to be missing; the guard refuses a DNS
  answer about any of them. So does a domain proved before we began carrying
  the ceremony's hash forward — a re-read that cannot compare a value is not
  evidence of anything, so those domains are left exactly as they were.

The deadline is written on the wavering fact and compared when a check runs,
not scheduled. A worker down over a weekend produces a lapse on the first tick
after it returns, rather than a lapse that silently happened while nobody was
looking.

### 5. A lapse stops NEW people and nothing else

The narrowness is the decision, not an implementation detail:

| | LAPSED |
|---|---|
| Existing members signing in | unchanged |
| Connection lifecycle state | unchanged (stays ACTIVE) |
| Routing, `verifiedDomains`, domain ownership | unchanged |
| Provisioning an unknown subject on first sign-in | **stops** |
| Walking in by domain (automatic joining) | **stops** |
| Asking to join | still works — it reaches a human |
| Inviting somebody | still works |

Two enforcement points, both per domain:

- `SsoConnectionDomainRoutingRepository.routable()` answers `allowsJit: false`
  for a lapsed domain. Routing is untouched — the door opens, the state and
  `configured` are the same — and what changes is only whether an unknown
  subject is provisioned.
- `JoinCandidateOrganization.domainProofLapsed` makes
  `organizationAdmitsDomainAutomatically` answer no, and
  `assertDomainProven` refuses to newly open automatic joining on such a
  domain. `organizationAdmitsDomain` — asking — is deliberately untouched: a
  request reaches somebody at the company, who is exactly the person able to
  tell a colleague from whoever bought a domain the company let go.

`lapsedDomains` is a column beside `verifiedDomains` rather than a read of the
JSON: both questions are asked on a sign-in path and have to be one indexed
predicate, not a fold.

### 6. Two emails, and neither carries a secret

On entering `WAVERING`, every organization administrator is told what to
publish, where it goes, and the deadline. On `LAPSED`, a second mail says what
stopped and — just as loudly — that everyone already there signs in as before,
because an administrator reading "your domain has lapsed" at 2am will
otherwise assume their company is locked out.

Neither carries the token value. We keep only its hash, so there is nothing to
send even if it were wise to; both point at the settings page, behind a session
and a permission, where a fresh record is issued. Send failures are logged and
never thrown: a deployment with no email provider is an ordinary self-hosted
install, and a domain must still waver and still lapse there. The alert is a
courtesy; the rule is the rule.

## Consequences

**A hosted customer can now go from nothing to live single sign-on without
anybody at LangWatch being awake.** Epic Open Q2 is answered by deletion: the
queue nobody could staff is a queue that only lists disputes, which are rare
and genuinely need a person.

**Every domain now costs three DNS lookups a day.** Bounded (500 per sweep,
3s timeout, 2 tries) and against other people's nameservers, so it is a real
if small external cost. A deployment with more proved domains than one batch is one
whose sweep should be a capacity conversation, not one that silently skips
half of them — hence a ceiling rather than a page.

**A domain can now stop vouching without anybody doing anything.** That is the
point, and it is also the new failure mode: a customer who reorganises DNS
and does not read email loses automatic provisioning two days later. The
mitigation is the grace window, six chances to notice a republish before
anything stops, and two emails — not a shorter window.

**`SsoDomainVerification` grew four fields** (`proofState`, `firstAbsentAtMs`,
`graceEndsAtMs`, `tokenHash`). Stored rows written before this decode with
them defaulted — `VERIFIED`, and no hash — which is honest: a domain nothing
had contradicted, and one we cannot re-read. Those domains keep the old
"proved forever" behaviour until they are re-proved through the ceremony,
which is a deliberate non-migration rather than an oversight.

**Nothing about existing sign-ins changed, and that constraint shaped every
other decision here.** A lapse that suspended a connection, or removed a
domain from `verifiedDomains`, would have been simpler to implement and would
have turned a DNS mistake into a company-wide outage.

## Deployment Impact

**A new repeatable worker joins the worker fleet.** `bootSsoDomainReproofWorker`
is registered in `startWorkers()` beside the break-glass sweep — an in-process
interval loop, not a queue job (this codebase removed BullMQ; recurring work is
a chained `setTimeout` with a `stop()` handle pushed onto the shutdown
handles). It runs on the `worker` role and on dev's in-process `all`, every
**8 hours**, first tick **5 minutes** after boot so a crash-looping pod makes
no outbound DNS lookups and no ledger writes before it has stayed up.

**Outbound network from the worker fleet.** The worker makes DNS TXT lookups
to arbitrary customer nameservers. Worker pods must be able to resolve
external names; a fleet behind an egress policy that only allows the
datastores will log `unreachable` on every sweep — which is safe (no clock
advances, nothing lapses) and silent apart from a warn line, so it is worth
checking rather than assuming.

**Outbound email from the worker fleet.** Waver and lapse notices are sent
from the worker, not from a request. A deployment whose email provider is
configured only for the web role will log a warn per administrator and carry
on.

**Two additive migrations.**
`20260827120014_sso_connection_last_reproof_at` adds the separate operational
cursor table used to revisit connections round-robin without giving the
event projection a second writer.
`20260827120017_sso_connection_lapsed_domains` adds
`SsoConnection.lapsedDomains TEXT[]` and a GIN index on it. Neither needs a
backfill or takes a lock of consequence on a table this size. Both are safe to
deploy ahead of the code — the cursor stays empty and the column stays unread
until the worker and projection use them.

**Rollback** is deploying the previous image. The events remain in the log and
fold to the same projection minus the new fields; the column stays and stops
being written. There is no state a rollback strands.
