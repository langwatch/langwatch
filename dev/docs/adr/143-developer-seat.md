# ADR-143: The Developer seat, a member who owns a personal project and nothing shared

**Date:** 2026-09-30

**Status:** Accepted

## One-line

We add a third organisation membership, `DEVELOPER`, for people who send coding-agent traces to their own personal project and never touch the organisation's shared projects; Developers are counted but never capped, and a per-organisation setting chooses whether self-service joiners arrive as Full or Developer.

## Context

Organisations today have two paid seat kinds, both derived from `OrganizationUserRole`: Full (`ADMIN` or `MEMBER`) and Lite (`EXTERNAL`, read-only on shared projects). Every plan carries a `maxMembers` and a `maxMembersLite` limit and the licence guard refuses invites and role changes past them.

An enterprise customer wants its developers to send Claude Code traces to LangWatch. Each developer needs a login, a personal project and the ability to run queries and evaluations on their own traces. They do not need, and must not get, the organisation's shared LLMOps projects. The customer is at its Full seat cap, so today every one of those developers costs a Full seat and is blocked until seats are bought.

The customer's administrators also want every developer's traces visible together inside the organisation's shared project. That needs a rule of the form "project A may read project B" and trace queries that read more than one project. Neither exists on `main`. An open pull request (`feat/strict-feature-layout-v0`) carries both, unmerged.

Self-service joining (`Organization.domainJoin`, ADR-117) and SSO admission both hard-code the new member as `MEMBER` (`attachDefaultMembership`). At the seat cap, every such join is refused.

## Decision

We will:

1. **Add `DEVELOPER` to `OrganizationUserRole`.** One migration. A Developer is a full organisation member for the purposes of login, personal project, CLI, queries, analysis and evaluations inside that personal project.
2. **Keep the Developer out of every shared project.** A Developer holds no role binding anywhere except their personal team. That includes the organisation-scoped binding every `ADMIN` and `MEMBER` receives at invite, join and role change: it is never written for a Developer. Invites, role changes and CLI login all enforce it. Downgrading Full to Developer deletes the person's shared team bindings and their organisation-scoped binding, and keeps their personal project, traces and keys. This deletion is new code; today's role-change recompute only corrects team roles, it never removes a binding.
   - Keys need no revocation. A user-owned key is clamped at check time to what its owner may do right now (ADR-092 §9, `decideWithCeiling`), so a key on a shared project stops working the moment the downgrade lands. The one exception is the project's own shared key, which has no owner and no ceiling; that is today's behaviour for any leaver and is out of scope here.
   - SCIM never produces `DEVELOPER`; its group mappings keep resolving to `ADMIN` or `MEMBER`. A sync leaves an existing `DEVELOPER` row alone and never rewrites its role (v3, fact 2). A SCIM group mapping that lands people as Developers is a follow-up.
3. **Count Developers, never cap them.** `member-classification.ts` gains a third member type. The plan page shows three counters. No plan limit applies to Developers.
4. **Let the organisation choose the joiner seat.** A new `Organization` column names the role given to self-service (domain) joiners and SSO-admitted users: `MEMBER` or `DEVELOPER`. Default `MEMBER`, so existing organisations behave exactly as before. It is changed only on the organisation settings page, never inside the join flow.
5. **Ship the seat alone.** Traces appearing inside the shared project is a later change, built on the "project may read project" rule once it lands on `main`, whether from the open pull request or from our own implementation of the same idea. Until then a Developer's project stays visible to its owner only, exactly as personal projects are today.

## Constants

| Name | Value | Where |
|---|---|---|
| Joiner seat default | `MEMBER` | `Organization` column default |
| Developer plan limit | none | `MemberTypeLimits` carries no Developer field |
| Developer team role on personal team | `ADMIN` | personal team provisioning, unchanged |

## Invariants

- A trace is stored once, in the project the developer's key points at, which is their personal project.
- A Developer holds no role binding at any scope other than their own personal team. In particular no `TeamUser` row on a team where `isPersonal` is false and no organisation-scoped binding.
- `ORGANIZATION_TO_TEAM_ROLE_MAP[DEVELOPER]` is never `ADMIN`. An organisation-scoped admin binding opens every project.
- Every `=== EXTERNAL` or `!== EXTERNAL` check on `main` is reviewed for `DEVELOPER`. The fifteen sites found by the red-team are listed in the Gates table. A site that is not reviewed treats a Developer as Full.
- Changing a member's role never deletes a personal project or its traces.
- A `DEVELOPER` row never makes a licence guard fail, and never makes a Full or Lite count move.
- The joiner seat setting never applies to invitations; an invite always names its role.

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Every user gets a personal project on first login (`PersonalWorkspaceService.ensure()`) | A Developer has nowhere to send traces; CLI login has no project to hand out |
| One organisation is the tenant boundary; a Developer belongs to one organisation | A person in two organisations would need a seat kind per organisation; the role is already per `OrganizationUser` row, so this holds by construction |
| Total trace volume across developers stays inside the customer's contract | Ingest is throttled by contract, not by seat; the seat model is unaffected, the customer conversation is not |
| Self-service joiners and SSO-admitted users want the same seat | One organisation wants SSO users as Full and domain joiners as Developer; the single setting becomes two |
| `MEMBER` is hard-coded in exactly three admission writers: `join-request-adapters.ts` (role and organisation binding), `sso-arrival.service.ts`, `sso-membership.prisma.repository.ts` | A fourth writer keeps admitting Full seats whatever `joinerRole` says |
| The authorisation engine grants project access through bindings only; an organisation-scoped non-admin binding carries the organisation floor and nothing more (`packages/authz/src/matchers.ts`, `bindingGrants`) | A Developer with a leftover organisation binding could read shared projects; the downgrade must then also be verified end to end, not only by row counts |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| Add `DEVELOPER` enum value (migration) | Additive only; removing a used value is not | Small | Human review of the migration; no down path needed, the value is never removed |
| Add `Organization.joinerRole` column with default | Yes | Small | None beyond the migration review |
| Invite / role change lands a Developer | Yes (role change) | Small | Spec scenarios bound to tests: a Developer has zero bindings outside their personal team, organisation scope included |
| Full to Developer downgrade | Yes (role change back) | Medium: shared team and organisation bindings are deleted | Integration test: downgrade a `MEMBER`, then ask the engine for `traces:view` on a shared project and expect denied; personal project, traces and keys survive; deletions logged |
| Enum consumers that branch on `EXTERNAL` only | Yes | Medium: each site silently treats a Developer as Full | Every listed site changed or explicitly confirmed: `memberRoleConstraints.ts` (map, label, allowed roles, default role, auto-correct), `compute-effective-team-role-updates.ts`, `organization.prisma.repository.ts` role-change binding write, `invite.service.ts` (accept, seat check, classify), `role-binding.service.ts` seat assertion, `permissions.service.ts` and `permission-adapters.ts` denial copy, `api-key.repository.ts` admin-key eligibility, `cli-login-key.service.ts`, `useInviteActions.ts`, `TeamsAndProjectsSection.tsx`, `MemberAccessEditor.tsx`, `managementApiOrg.ts` |
| Public contract widens | No (once accepted by clients) | Small | Management REST API, tRPC and billing invite (`subscriptionRouter.ts`) accept `DEVELOPER`; the OpenAPI document and SDK types list it in the same pull request |
| SCIM sync meets a `DEVELOPER` row | Yes | Small | Test: a sync leaves the row `DEVELOPER` and asserts no organisation-scoped grant for it (v3: no sync path rewrites an existing row's role on either write path, so "asserting `ADMIN` promotes it" is not current behaviour and is not built here) |
| CLI login project choice | Yes | Small | Test: a Developer picking a non-personal project gets a handled error |
| Seat counting | Yes | Small | Test: `DEVELOPER` rows never move Full or Lite counts and never trip the licence guard |
| Domain join / SSO admission reads the setting | Yes | Medium: wrong seat for every joiner of that organisation | Test: default organisation still admits `MEMBER`; setting flipped admits `DEVELOPER` |

## Schema

```prisma
enum OrganizationUserRole {
  ADMIN
  MEMBER
  EXTERNAL
  DEVELOPER
}

model Organization {
  // ...
  /// The organisation role handed to a person admitted without an invitation:
  /// a self-service domain join (`domainJoin`) or an SSO-admitted login.
  /// `MEMBER` (default, a Full seat) or `DEVELOPER`. Set on the organisation
  /// settings page only; the join flow never asks.
  joinerRole OrganizationUserRole @default(MEMBER)
}
```

`OrganizationUser.role` is unchanged. `MemberType` in `member-classification.ts` becomes `Full | Lite | Developer`.

### Addendum (v6): arrivals from the terminal

A join request records where it was made: `web` or `cli`. The device-approval page that `langwatch login` opens sends a new account through sign-up to the welcome screen with the terminal's continuation in hand, and the welcome screen stamps `cli` on the request it makes from there. The seat an approval or an automatic door grants is decided from the origin and the joiner seat together: a `cli` request always lands a Developer, a `web` request lands the joiner seat, exactly as before. Approval stays one click and carries no role choice. The origin only ever lowers the seat, so the browser may assert it.

```prisma
model JoinRequest {
  // ...
  /// Where the request was made: `web` or `cli`. A request from the terminal
  /// lands a Developer seat whatever the joiner seat says.
  origin String @default("web")
}
```

The same change makes the welcome screen look for a pending invitation on the account's verified addresses before offering to ask, so an administrator who already invited somebody as a Developer is not asked the question twice. Acceptance runs the invitation's own path, so the seat is the one the invitation names.

## Rejected alternatives

- **Developer as a Lite (`EXTERNAL`) member with a personal project.** Lite is read-only on shared projects and still consumes a capped seat. The Developer must act, not read, and must not be capped. Reusing the value would tangle two meanings in one enum.
- **A flag on `OrganizationUser` instead of a new role.** Fifty-one files switch on the role enum. A second axis means every one of them needs a second check. One enum value is one place to look.
- **Building the "project may read project" rule and multi-project trace queries now.** The open pull request already covers that ground. Doing it twice throws one version away; doing it here delays developers who can start sending traces this week.
- **Company administrators opening a Developer's project directly.** Rejected for this release. It is a second access path that the later shared-project view would make redundant, and it changes the personal-project privacy rule for a stopgap.
- **Asking the joiner which seat they want during the join flow.** Adds friction to a flow that is meant to be a single click. The organisation decides, once, in settings.

## Consequences

- Positive: the customer's developers join without buying Full seats; existing organisations see no change; the seat count is honest on the plan page.
- Negative: until the shared-project read lands, administrators see nothing of Developer traces. That gap is deliberate and time-boxed to the follow-up change.
- Neutral: `OrganizationUserRole` grows to four values; the `Exclude<OrganizationUserRole, "EXTERNAL">` types in tests and the REST wire schemas need the new value listed.
- Follow-up: the shared-project view becomes a second pull request that adds one whole-project grant per Developer at admission, kept on offboarding, on top of whichever "project may read project" implementation reaches `main` first.

## Open questions

- Whether a Lite member may log in through the CLI at all. Not blocking.
- Whether offboarding a Developer deletes their traces or keeps them for the shared view. Not blocking; defaults to keep.
- Price per Developer seat. A billing decision, outside this ADR.

## References

- ADR-001 RBAC, ADR-092 unified authorisation, ADR-110 grant aggregates, ADR-117 domain auto-join.
- `platform/app/src/server/license-enforcement/member-classification.ts`
- `platform/app/src/server/app-layer/identity/join-request-adapters.ts` (`attachDefaultMembership`)
- `specs/identity/domain-auto-join.feature`

## Hand-off

- Branch `feat/developer-seat`, worktree `.worktrees/seat-model`, one pull request against `main`.
- Entry point: spec `specs/members/developer-seat.feature`, written first; the first test binds its downgrade scenario to the engine's `traces:view` decision on a shared project.
- Migration follows `20260928120003_trigger_sent_history_index`: enum value and `Organization.joinerRole` in one file.
- Captain: Sergio. Locked 2026-09-30.

## Revisions

- v1, 2026-09-30: drafted after parc fermé. Captain: Sergio.
- v2, 2026-09-30: red-team (two lenses, correctness and second-order). Verdict: survives, narrowed. Changed: the "no shared access" invariant now covers every binding scope, not only `TeamUser` rows, because Full members also carry an organisation-scoped binding; downgrade is named as net-new deletion code and gated by an end-to-end permission test; keys need no revocation, the owner ceiling clamps them at check time; SCIM never emits `DEVELOPER` and preserves it on sync unless the directory asserts `ADMIN`; the fifteen `EXTERNAL`-only branch sites, three hard-coded `MEMBER` admission writers and the widened public contract are listed as gates. Not attacked: ingest and storage, the later shared-project view, price, personal-project provisioning on SCIM and SSO paths. Captain: Sergio.
- v3, 2026-09-30: implementation (PR langwatch/langwatch#8373). Three facts the build surfaced, none reopening the decision. (1) Group bindings are a shared-access route no row rule reaches, so the authorisation engine now caps a `DEVELOPER` principal at resolution: an ORGANIZATION-scoped binding and a group-delivered binding grant it nothing, a direct row on its own team grants as before, and the denial reason is `developer-restricted`. (2) SCIM never rewrites an existing member's role on either write path; the legacy path minted an organisation-scoped `MEMBER` grant for every synced person and now skips a Developer. The Gates row is corrected accordingly. (3) The ledger writer sends revocations one at a time: in memory mode (no Redis) a batch as wide as the queue's concurrency deadlocked, because each command job waits on projection jobs sent to the same queue, and a move to the Developer seat revokes that many rows as a matter of course. Captain: Sergio.
- v4, 2026-09-30: ruthless review of the implementation. Two facts, neither reopening the decision. (1) A Developer admission has no grant, and the join-request notifier waited for one before emailing anyone, so a Developer joiner on the domain or join-request path sent no email and burned every outbox attempt; the gate now treats the membership row as the admission for a Developer. The single sign-on path likewise announced only after a grant landed, so it now announces a Developer straight after the row is written. (2) A Full member's admission reaches the audit page through their organisation-wide grant; a Developer has none, so every admission path writes its own `organization.member.admitted` row with the seat and the route. The spec scenario "Directory sync can still promote a Developer to administrator" is removed: no sync path rewrites a row's role (v3, fact 2), so it described nothing this release builds. Captain: Sergio.
- v6, 2026-10-02: arrivals from the terminal (langwatch/tasks#926). A join request carries its origin, `web` or `cli`, as a fact on the requested event and a column on the projection row. The seat is decided from origin and joiner seat together: `cli` lands a Developer on approval and on an automatic door, `web` keeps the joiner seat. The pending list shows the seat each request will land as, read only. The welcome screen leads with a pending invitation on a verified address before offering to ask, and admits an automatic door, which it never did. Deferred to a second change: how the waiting screen behaves for a terminal arrival while the device code expires. Captain: Sergio.
- v5, 2026-10-01: the seat gates the organisation-wide products (PR langwatch/langwatch#8373). A Developer holds a member's permissions inside their own project, and the product gates are answered on the project in view, so `virtualKeys:view` let a Developer onto the Gateway product and the key listing showed them every organisation-scoped key, because that listing is membership-based. The product registry now says a Developer reaches no organisation-scoped product (`seatReachesProduct`), the switcher, the rail, the landing resolver and the page guard all ask it, and the gateway key listing treats a Developer, and a Lite Member, as sharing in no organisation-scoped key. LLM Ops on their own personal project stays allowed, as decided in v1. Captain: Sergio.
