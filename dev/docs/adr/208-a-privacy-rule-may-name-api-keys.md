# ADR-208: A privacy rule may name API keys among who sees its restricted content

**Date:** 2026-11-25

**Status:** Accepted (v5, 2026-11-27)

> One line: an API key reads restricted trace content as **the public** unless a **privacy
> rule's audience names that key**, next to Admins, members and groups; a named key reads that
> rule's restricted content **as Admins do**, until **the key itself** expires or is revoked or
> the rule drops it, and every change and the **first read per key, project and day** is audited.

## Context

- A project can restrict trace input, output, system instructions and tool calls to an
  audience (Admins, members, viewers, the project owner, groups). Every API key reads that
  content as the public, because a key has no session: `resolveForApiKey`
  (`modules/trace/process/src/services/trace-viewer-protection.service.ts`) and
  `resolveApiKeyProtections` (`modules/analytics/process/src/services/workbench-protections.service.ts`).
  This was never weighed: it dates from the first redaction PR (#278, 2025-04-30). A spec
  states it (`specs/coding-agent/transcript-rest.feature:23`).
- A customer runs an agent on their own infrastructure and wants one key to see what an Admin
  sees. Keys with All permissions got `[REDACTED] (visible to Admins)`, reproduced live. The
  MCP OAuth sign-in was a separate fix (#9910, live 2026-11-26).
- Keys are long-lived, get copied into config and CI, skip SSO and 2FA, and an agent sends
  what it reads to its model provider. Closed by default stays right; closed with no way to
  open it does not meet a real need.
- The privacy rule's audience is already the one place that says who sees restricted content
  (`modules/data-privacy/contract/src/data-privacy.ts`, `groupIds` beside the role flags).

## Decision

1. **The audience names the key.** The rule's audience gains `apiKeyIds`, beside `groupIds`.
   No column on `ApiKey`, no permission: the privacy rule stays the one source of who sees
   restricted content (p14).
2. **Off by default.** An audience names no key until someone picks one. "All permissions"
   never implies it.
3. **A named key reads as Admins do, for that rule only.** It sees what the rule restricts,
   in the rule's scope, and only where Admins see it: an audience naming keys must hold Admins
   (or All members), and picking a key in the picker keeps Admins in it. It never joins groups
   or becomes the project owner.
4. **Only an organization admin adds a key.** Anyone who may edit the rule keeps the keys it
   already names; adding a new one needs `organization:manage`, the same reach that lists every
   key on the API keys page. A key cannot add itself.
5. **It ends with the key.** The key's own `expiresAt` and revocation end it; there is no
   second end date. Dropping the key from the audience ends it at once.
6. **Picked by name, explained in place.** The audience picker gains an "API keys" group: for
   an organization admin every live key of the organization, for another editor only the keys
   the rules they can read already name, each by the name its owner gave it, with a line saying
   a picked key sees what Admins see. A confirm dialog states what opens and until when, and
   the rules table counts the keys a rule names.
7. **The redaction tells the key how to open it.** A redacted value's label points to the
   privacy rule, so a key's holder knows what to ask an Admin for.
8. **Audited.** Adding or removing a key is a rule save, which writes the generic tRPC audit row
   carrying the saved config; the row before it is the previous state. The first restricted
   read per key, project and UTC day writes `restricted_content.viewed` (actor key, project),
   modelled on `braided_spans.viewed` (a follow-up PR).
9. **Only a customer's live service key.** The picker lists the organization's service keys
   that are not revoked, expired, minted by LangWatch (Langy, runs, gateway), ingest keys, docs
   session keys or CLI device children (decision 6 says to whom). A personal key acts as its
   person and never reads more than they do, so a rule never names one: naming it would let a
   member read through their own key what their account is denied. The cost: an agent must
   run on a service key, which an Admin makes on the API keys page. A save naming any
   other key is refused, except one the stored rule already named, so revoking a key never
   blocks editing its rule. Custom attribute rules cannot name keys: no key reads them. Only a
   restricted category names keys, and every restricted category of a rule names the same
   ones: the drawer edits one audience for all of them, so differing sets would be silently
   merged by the next edit. The cost: the API cannot give input and output different keys;
   two rules on narrower scopes can.
10. **Both choke points read it.** `resolveForApiKey` and `resolveApiKeyProtections` pass the
    key's id into the one `isContentVisibleToKey` check, so trace REST, MCP, LangWatchQL,
    dashboards and Instant Eval previews agree. Across projects, only a key every rule names
    survives the strictest fold, `allMembers` audiences included.
11. **data-privacy reads keys through a bound channel.** It binds `ApiKeyApi` (record §5)
    instead of naming it a peer: api-key reaches project, and project depends on data-privacy.

## Constants

| Name              | Value                         | Purpose                                      |
| ----------------- | ----------------------------- | -------------------------------------------- |
| Audience field    | `apiKeyIds: string[]`         | Keys that read the rule's restricted content |
| Read audit window | 1 UTC day per key and project | First restricted read writes one row         |
| Audit action      | `restricted_content.viewed`   | Read audit row                               |

## Invariants

| Invariant              | Meaning                                                          | How it holds (test anchor)                                         |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Off by default         | No key reads restricted content unless a rule names it           | Empty `apiKeyIds` default; an "All" key reads public (unit)        |
| Never more than Admins | A named key never sees group-only or owner-only content          | `isContentVisibleToKey` owner and group audiences, the fold (unit) |
| Ends with the key      | Expired or revoked key: refused at the door before any read      | Existing key door tests                                            |
| Never on Langy keys    | A Langy session key cannot be named                              | `foreignApiKeyIds` and the save refusal (unit)                     |
| Both surfaces agree    | Trace REST and LangWatchQL give the same answer for the same key | One `isContentVisible`, tested from both resolvers (unit)          |

## Assumptions

| Assumption                                                        | What breaks if false                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Every key read of trace content goes through the two choke points | A missed path would keep redacting                                 |
| Customers name a handful of keys per rule                         | The picker lists every live key in scope; a long list needs search |

## Gates

| Path                                         | Reversible?             | Blast radius             | Required gate                                                |
| -------------------------------------------- | ----------------------- | ------------------------ | ------------------------------------------------------------ |
| Audience schema (`apiKeyIds`, default empty) | Yes (additive)          | Small                    | Schema tests; old rules parse unchanged                      |
| Visibility check reads the key               | Yes                     | Large (content exposure) | Unit tests for every invariant, live before/after on a stack |
| Picker "API keys" group + confirm            | Yes                     | Small                    | Mock approved (2026-11-26); component tests                  |
| Redaction label wording                      | No (published API text) | Small                    | Spec scenario; label tests                                   |

## Rejected alternatives

- **A switch on the key (ADR v1):** a second place saying who sees restricted content, and a
  second end date beside the key's own (p14).
- **A tick when creating the key:** same second source; the privacy page would not show it.
- **One tick for all Admins' keys:** opens every key an Admin holds, old ones in scripts too.
- **A registry permission:** a minted-only one cannot sit on a key; a scoped one lands on every
  Admin "All" key the day it ships.

## Consequences

- Positive: one place answers who sees restricted content; the customer's case works; MCP, CLI
  and SDK reads through a named key see the content; no new key columns.
- Negative: a named key that leaks exposes restricted content until it is revoked, expires or
  is dropped; each key is picked per rule.
- Neutral: unnamed keys are unchanged.

## Open questions

- R9: analytics treats `project:update` (held by Members) as admin; a separate security fix.
- Self-hosted licence gate (Enterprise only)? Owner to decide; not blocking.

## Revisions

- v1 (2026-11-25): a switch on the key, reading as an Admin, with an optional 90-day end date.
- v2 (Sergio, 2026-11-26): after comparing three mocks (keys picked in the rule, a tick when a
  key is created, one tick for every Admin's key), keys are picked in the rule. Columns on
  `ApiKey`, the granter re-check and the second end date are dropped.
- v3 (2026-11-26): built. Decision 8 corrected: a rule save writes the generic tRPC audit row;
  the read audit and the redaction hint (decision 7) ship as follow-ups. Decisions 9 to 11
  record what the build found. Review round 1 narrowed decision 3 (a key read past Admins
  where a rule named only the owner or a group) and decisions 4 and 6 (listing every key to
  any rule editor showed Members other people's key names).
- v4 (2026-11-26): review round 3 narrowed decision 9 to service keys. A personal key named in
  a rule let its owner, a plain member, read Admin content their account could not.
- v5 (2026-11-27): review rounds 4 to 9 added to decision 9 that keys sit only on restricted
  categories (a new refusal) and that each names the same keys (refused since v3). Adding a key without
  `organization:manage` answers its own 403 (`data_privacy_api_key_add_forbidden`).
