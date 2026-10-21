# ADR-183: Braids show one project's matching spans in another project's traces

**Date:** 2026-10-21

**Status:** Proposed

**Builds on:** [ADR-166](166-grant-scoped-data-access.md) (the sealed `Authorization` proof, the shared grant
and its `condition`, the OTTL grant compiler in authz's portable engine, §4),
[ADR-177](177-aggregate-project-reads-member-projects-through-grants.md) (the first shared grant: the
`project-reader` placement, the door that mints shared grants into the proof, the store client's fence,
v4.7's constant-size fence and v4.9's rule that a window opens only its own resource),
[ADR-110](110-grant-aggregates-are-grants.md) (a grant is an aggregate). **Related:**
[ADR-057](057-token-gated-trace-sharing.md) (share links, which own the words "trace sharing").

Specs: `modules/authz/specs/braids.feature`, `modules/authz/specs/braids-screen.feature`,
`modules/trace/specs/braided-spans.feature`, `modules/trace/specs/signed-calls.feature`,
`modules/api-key/specs/signing-keys.feature`. Design: `dev/docs/plans/braids/braids-prototype.html` and the
brand kit beside it.

> One line: a **braid** is a shared grant from an owner project to a reader project. The reader's trace
> view shows the owner's spans that match the braid's condition, inside traces the reader already has,
> matched by trace id. Nothing is copied. Release 1 is Enterprise only, read-only, created by whoever holds
> the new `braids:manage` permission on the owner (project and organisation admins), and ships with call
> signing, so a condition can require that the reader really made the call.

## Context

Agents call agents in other projects. The calling project (an orchestrator) records its half of a trace;
the called project (a team of specialist agents) records the rest under the same trace id, because the
`traceparent` crosses the call. Each project sees only its own spans, so the orchestrator's trace stops
at the project line. A customer asked for exactly this view, with an admin-written condition, a role, a
data window, an expiry and a live preview. The internal design ("sharing is caring", ADR-166) already
named the shape: a grant `condition { type, where, from, until }`, an OTTL condition compiled on save,
signed baggage, and an audit of reads.

ADR-177 built the first half for aggregate projects. What exists and what is missing:

| Piece                                               | Today                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Project-to-project shared grant, same organisation  | ✅ `project-reader` placement, `grantShapeRefinement` (`modules/authz/contract/src/authz-grant.events.ts`)                                  |
| `condition { type, where, from, until }` on the row | ✅ `grantConditionSchema` (`packages/authorization/src/authorization.ts`); a non-empty `where` is refused, and the door drops it            |
| The proof and the store client's fence              | ✅ `clickhouse.as(authorization, { reads })`, `{{tenantScope:<TimeColumn>}}`; only `trace` windows are honoured (v4.9)                      |
| A detail read across projects                       | ❌ `narrowAuthorization` fences a detail read to one project (v4.5), so one trace never mixes two projects' spans                           |
| TraceApi operations take the caller's proof         | ⚠️ the trace app mints an own-only proof for content reads (`#authorizeContentRead`, `trace.app.ts`)                                        |
| Privacy across projects                             | ⚠️ the strictest policy across the proof's projects (ADR-177 decision 9): over-redacts the reader, and evaluates viewer facts on the reader |
| OTTL compiler, signing keys, verification at ingest | ❌ none; `langwatch.reserved.*` is already stripped from client data at ingest (`stripReservedAttributes`)                                  |
| A door for an admin to create a share, and a screen | ❌ only the governance reconciler attaches shared grants                                                                                    |

"Trace sharing" already means public share links (ADR-057), so the feature takes a product name: **Braids**.
One share is a braid; a project braids its spans into another; the badge reads "Braided from <project>".

## Decision

### 1. A braid is a shared grant

A braid is one ledger row, written through authz's grant commands:

| Field         | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| principal     | `project`, the **reader** (the project whose traces show the spans)                                      |
| scope         | `PROJECT`, the **owner** (the project that recorded the spans)                                           |
| `roleKey`     | `project-reader`, unchanged: no new role. A `span` window cannot open a trace or analytics read (v4.9)   |
| `source`      | `"braid"`, added to `GRANT_EVENT_SOURCES`                                                                |
| `condition`   | `{ type: "span", where?, compiledWhere?, from, until? }` (§3)                                            |
| `expiresAtMs` | optional: when the reader stops seeing the spans. `from` and `until` bound which spans, never the access |

`from` may fall before the day the braid is made (decided by Alex, 2026-10-21): the reader then sees the
owner's matching spans recorded earlier, still only inside traces the reader already has.

`grantShapeRefinement` gains a second legal foreign placement beside ADR-177's: `project-reader` with a
`span` condition whose `where`, when present, carries its `compiledWhere`. A `trace` condition still refuses
a non-empty `where`, so an aggregate's grants are unchanged. Both projects live in one organisation; neither
is an `aggregate` or `internal_governance` project; a project never braids into itself. Each braid's grant
gets a fresh id (`newAuthzGrantId`), as the shared attach does today; a retried request reuses its command
id, never a derived grant id, so a braid removed and made again within one second is two grants.

**Several braids may join one pair** (decided by Alex, 2026-10-21), read as their union: an owner span
shows when it matches any live braid's condition inside that braid's window. A braid identical to a live one
on the same pair (same compiled condition, window and end date) is refused with `braid_already_exists`.
Every braid write runs under a transaction-scoped Postgres advisory lock keyed on the reader, as ADR-177
v4.4's reconciles run per aggregate: the shared attach's live-row check is not serialised with its write,
and the reader's limit on distinct conditions (§3) is counted under the same lock. A change names the braid
it changes; when that braid was changed or removed in the meantime, the change is refused with
`braid_changed`, so two people editing one braid at once never leave both edits live.

Refusals, each a `HandledError` from authz: `braid_into_itself`, `braid_across_organizations`,
`braid_aggregate_project`, `braid_governance_project`, `braid_already_exists`, `braid_changed`,
`braid_not_on_project`, `braid_condition_unsupported`, `braid_condition_too_large`,
`braid_condition_limit_reached`.

**Braids do not chain.** A proof holds only the grants whose principal is the project it is minted for. An
aggregate reading a member sees none of the spans braided into that member, and a braid into the reader
passes on none of the braids the owner itself receives.

### 2. Who may braid, and the door

Braids are authz's grant door, beside the existing grant routes, not a new module: a braid is a grant
(ADR-110) and authz owns the ledger. The routes that create and change a braid declare a permission at
each project, named by route parameters:

```
.withPermission("braids:manage", { at: "route", param: "ownerProjectId" })
.withPermission("traces:view", { at: "route", param: "readerProjectId" })
.withEntitlement("enterprise", { feature: "BRAIDS" })
```

- **A new permission, `braids:manage`** (decided by Alex, 2026-10-21: project admins may braid out of their
  own project). A `braids` resource whose one action is `manage`, appended last because the registry is
  append-only and declaration order is the bitset index (ADR-092 §1); `traces:braid` would move every later
  index. It joins the built-in admin role's additions. `traces:share` is not used: members hold it, and it
  governs public share links.
- **Project roles come from teams.** The built-in roles reach a project through a team: a team admin is
  admin of every project in that team, so "braid out of your own project" means "out of any project in a
  team you administer". An organisation admin holds it everywhere; a role bound to one project, or a custom
  role listing `braids:manage`, holds it there only. Members and viewers do not.
- **Nobody braids into a project they cannot read.** The door asks `traces:view` at the reader, so a team
  admin cannot send their team's spans to a team they have no view of; braiding across teams takes an
  organisation admin or someone the reader's team lets read its traces. The preview asks the same (§7),
  so the dialog works for exactly the people who may save it. The door declares one target per route
  today; it is extended to take one per project (§10, package 2).
- **The ceiling runs on the owner project.** The grant ceiling refuses a braid conferring more on the owner
  than the caller holds there, so a custom role holding `braids:manage` without `traces:view` braids nothing.
- **Either project's admins may remove a braid.** The remove route declares `braids:manage` at the project
  it names, and the service refuses a braid that does not touch that project with `braid_not_on_project`
  (a check on the loaded row). A reader's admins can end spans arriving that they never asked for.
- **An organisation can keep braids to its admins** (decided by Alex, 2026-10-21). One organisation
  setting, off by default, owned by authz because it decides who holds a permission. When it is on, team
  and project bindings in that organisation stop conferring `braids:manage`, as they confer no
  organisation-only permission (`bindingScopeCanGrantPermission`); only organisation-wide bindings do. The
  routes declare the same permissions either way. The organisation's snapshot carries the setting and a
  change bumps the epoch, so it applies within `BRAID_REVOCATION_BOUND_MS`. Live braids stay; what changes
  is who may create, change or remove braids and manage signing keys. The route that sets it declares
  `organization:manage` and Enterprise, and each change is audited.
- **A change is checked whole, then attached, then revoked.** The new condition is compiled and sized, the
  ceiling and the projects checked, before anything is written. Then, under the reader's lock, the new grant
  is attached and the old one revoked. If the attach fails nothing has changed; if the revoke fails both are
  live, the change reports failure, and repeating it revokes the old grant only. The attach event gains an
  optional `replacesGrantId`, its read support shipping one release before any route writes it, and the
  audit mapping copies it. `ChangeGrant` and a `grant.changed` event wait for release 2, on the same
  read-first rule, so an older worker never ignores a narrowing.
- **Removal is a revoke** with reason `braid_removed`, from either side.
- **Listing is open to both projects' members**, so the people whose spans leave a project, and the people
  who see them arrive, can both find out. The list route declares `project:view` at the project it names and
  no entitlement, so a downgraded organisation still sees its braids, marked paused (§9). A project's
  settings list braids "Into other projects" and "From other projects", offering create, change and remove
  only to whoever may do them there; the organisation's Braids screen lists every braid for its admins.
- **Audit.** Each grant event writes its own entry through `AUDIT_VERB_BY_EVENT_TYPE`: a change is a
  removal and a creation, the creation naming the braid it replaced. The audit subscriber reads a revoked
  braid's projects and condition from authz's own grant projection, so a removal's entry names both projects
  and the condition too. Nurturing learns of a new braid from the grant attached event with source `braid`;
  authz holds no analytics channel (CLAUDE.md rule 7).

### 3. Conditions: an OTTL subset compiled on save

The compiler lives in authz's portable engine (ADR-166 §4: `modules/authz/contract/src/engine.ts` today,
`@langwatch/authz-engine` when that move lands), never in `packages/`. It parses the text once, when the
braid is saved, into a typed tree (`compiledWhere`, a zod schema, with the compiler's version), stored
beside the text. The ClickHouse client renders the tree; nothing parses OTTL at read time.

| Release 1 accepts                                           | Compiles to                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `attributes["k"] == "v"`, `resource.attributes["k"] == "v"` | equality on the span's or its resource's attribute map           |
| `name == "v"`                                               | equality on the span name                                        |
| `attributes["k"] != nil`                                    | the key is present (`mapContains`), never a comparison with `''` |
| `Verified("k")`                                             | §4's verified mark for `k`, made with a key of the **reader**    |
| `and`, parentheses                                          | conjunction                                                      |

Refused on save, each with a fix the admin can act on: `or`, `not`, `IsMatch`, any comparison but string
equality, `!=` with a value, `== true`, and `== ""` (a missing key reads as `''` in a ClickHouse map, so it
would match spans that never set the key). An empty condition is legal and braids every owner span that
shares a trace id with the reader.

Rendering rules, each a security property:

- Every literal and every map key is bound as a parameter; each braid's predicate is fully bracketed.
- **Several braids read as their union, without `or` in a condition.** Each distinct compiled predicate
  renders one bracketed clause holding its owners and their windows, bound as array parameters as v4.7's
  fence binds them; the clauses are joined by `or`. One owner may sit in several clauses, each with its own
  window, so two braids on one pair show a span that matches either. The `or` is the fence's, between whole
  owner-bound clauses; a condition itself still refuses it.
- The latest version of each span is chosen first and the condition applied second, so an older version
  that matched cannot reappear after the span changed. The span reads choose the latest version in an
  inner subquery that carries its own `{{tenantScope:StartTime}}`, so the conditions get a marker of their
  own, written only on the outer select; the inner marker renders tenants and windows alone.
- Every cache and log key that the fence feeds (`readScopeKeyOf`, `tenantScopeKey`, the discovery and facet
  caches) carries a digest of the compiled tree and the compiler version.
- **Size is bounded at every level.** One condition holds at most `BRAID_CONDITION_MAX_LENGTH` characters
  and `BRAID_CONDITION_MAX_TERMS` comparisons, nested at most `BRAID_CONDITION_MAX_DEPTH` deep, or it is
  refused with `braid_condition_too_large`. Braids are grouped by distinct compiled predicate, and a reader
  holds at most `BRAID_MAX_DISTINCT_CONDITIONS`, past which a new one is refused with
  `braid_condition_limit_reached`. The client measures the rendered statement before sending it and refuses
  one over its budget by name. The size test runs the largest legal proof against ClickHouse's 256 KiB
  statement limit before release.

### 4. Signed calls, in release 1

A condition on a tag the caller sets (`attributes["orchestrator"] == "web"`) trusts every caller in the
organisation. Signing lets a braid require that the reader really made the call.

- **Signing keys belong to the API key module**, which handles credentials: a Postgres table it owns, the
  secret encrypted at rest by the process's `encryption` store (AES with rotation, as the secret module
  stores its values; a hash would not do, since verifying needs the secret), returned once from the create
  mutation and never from a query (record §10). Never `Project.apiKey`. Whoever can create a braid manages keys (decided by Alex,
  2026-10-21): create, rotate and revoke declare `braids:manage` at the key's project, the calling project
  whose calls it signs, and Enterprise; each is audited.
- **Rotation** issues a new key and keeps the old one verifying for `SIGNING_KEY_ROTATION_OVERLAP_MS`.
  **Revocation** ends a key at once, bounded by the key lookup cache (60 s, record §7).
- **The SDK helper** (TypeScript, Python, Go). On the calling side it signs the baggage entries it names:
  an HMAC-SHA256, under the key, over the trace id and the sorted entries, carried with the key's public id
  in one baggage entry. On the called side it copies the named entries and the signature onto each span, by
  wrapping OpenTelemetry's own baggage span processor. The wire format is below.
- **The wire format, version 1.** The secret is one string, `lwsk_<publicId>_<secret>`, and the HMAC key is
  its UTF-8 bytes. An entry key matches `[A-Za-z0-9._-]{1,128}`; values are the decoded baggage strings.
  The signed message is `langwatch-braid-signature-v1`, the trace id in lower-case hex, then one
  `<key>=<value>` per entry in ascending code-point order of key, all joined by `\n`. The signature travels
  as the baggage entry, and the span attribute, `langwatch.signature`: base64url without padding of the JSON
  `{"v":1,"kid":"<publicId>","keys":[...sorted keys],"sig":"<base64url HMAC>"}`. The entries themselves
  travel as baggage under their own keys and become span attributes of the same names.
- **What a signature proves, and its boundary.** It covers the trace id and the entries, not one hop: baggage
  travels down the call chain by design, so every call the reader's call leads to within that trace carries
  it, and any project that receives it can carry it further within that trace, and only that trace.
  `Verified("k")` therefore means "the reader signed `k` for this trace", which is what a braid needs: the
  reader's call led here. Binding a signature to one recipient would break every chain of more than one hop.
  A signature does not verify in any other trace.
- **Verification at ingest**, in the trace module's span admission. A span carrying a signature asks
  `ApiKeyApi` (cached) for the key by its public id, within the span's organisation. A valid signature
  writes `langwatch.reserved.verified.<k>` = the signing project's id for each signed entry `k`; a failed one
  writes nothing for those entries and records the key id and outcome, which the keys screen counts over
  24 hours. A key lookup that cannot run leaves the span unverified; ingest never refuses for it.
- **No forged mark exists.** `langwatch.reserved.*` is already stripped from client data before storage,
  and the verified prefix never joins `RESERVED_ATTRIBUTE_PASSTHROUGH`. `Verified("k")` compiles to
  `SpanAttributes['langwatch.reserved.verified.k'] = {reader}`, the reader bound when the fence renders.

### 5. The trace view merges; everything else stays the project's own

The reader's trace view shows the owner's matching spans in traces the reader already has. The reader's
trace list is unchanged: owner-only traces, list totals, search, filters, analytics, REST, MCP, exports and
Langy stay the reader's own in release 1, and a public share link shows only the project's own spans.

- **The detail read keeps braids.** `narrowAuthorization` still fences an aggregate's detail read to one
  member (ADR-177 v4.5). For a plain project it keeps the own grant and the project's `span` braids.
  Owner spans are matched per owner on `(TenantId, TraceId)` against the reader's trace, within the braid's
  `from`/`until` window on `StartTime`, under the compiled condition.
- **TraceApi operations take the caller's proof.** Content reads stop minting an own-only proof in the trace
  app; the trace route gate extends to refuse a content read that mints its own.
- **Per span, per owner.** Each span carries its owning project. Offloaded bodies resolve under that
  owner; two projects holding the same span id stay two spans. Each span is redacted under its **owning
  project's** policy, and role-keyed audiences are evaluated against the viewer's standing on that owner: a
  viewer with no role there is outside every role-keyed audience. The reader's own spans keep the reader's
  policy. ADR-177's strictest-wins fold stays for aggregates.
- **Side reads** (annotations, the evaluations panel) read only the reader's own `(TenantId, TraceId)`
  pairs.
- **The view says where spans came from.** A braided span carries a badge naming its owning project. A span
  whose parent the reader can see hangs under it. A span whose parent was not braided is shown at the top of
  the trace, as a span with a missing parent is today: nothing about a span that was not braided, its id or
  its place in the tree, is read to place it, and nothing hints at it. Playground, annotation and evaluation are off on a braided span, each with a reason;
  "Open in <owner>" shows only to a viewer who can open the owner. The trace header's totals include
  braided spans and say so; the list keeps its own totals.

### 6. Evaluations are not shared

Decided by Alex (2026-10-21): neither direction in release 1. The reader sees no owner evaluation result on
a braided span, and no reader monitor runs on one; the evaluation trigger subscriber is untouched. Sharing
them becomes an explicit per-braid option later (release 3).

### 7. The preview

The braid dialog previews what the reader will see before anything is saved.

- A route in the trace module that declares `traces:view` at **both** projects, owner and reader, named by
  route parameters. The door asks both before the handler runs and hands it a proof for each, so the preview
  never shows either project to someone who cannot read it and the service checks nothing (CLAUDE.md rule
  6). It uses the door's two-target declaration that the braid routes need (§2).
- It compiles the unsaved condition and counts the **reader's** traces over the last 7 days: every owner
  span braided, some, or none; with `Verified()`, how many otherwise matching calls had no valid signature.
  Latest versions, the condition outside the WHERE so traces with nothing braided stay in the count; bounded
  to the reader's own traces, so it stays cheap; debounced in the browser.
- **Test a trace:** a trace id renders that one trace exactly as the reader will see it.
- The dialog names how many people will see the spans: the count of the reader's members holding
  `traces:view`, read through `AuthzApi`.

### 8. Audit and revocation

- **Reads.** The read audit generalises from "the project is an aggregate" to "the proof carries a shared
  grant": opening a trace with braided spans writes one `braided_spans.viewed` row per actor, reader and
  owner, deduplicated for five minutes (`ADMIN_WORKSPACE_VIEW_DEDUP_MS`). The row names the owner and the
  braid, never a span. The audit metadata of a braid event carries its condition text: its writer can read
  both projects, and only organisation-wide `auditLog:view` holders read the log (ADR-177 v4.4 deferred
  this to the compiler's arrival).
- **A removed braid stops showing within `BRAID_REVOCATION_BOUND_MS`**, on every read. Two things hold it
  there. New proofs read the organisation's epoch-cached snapshot, whose ceiling is that bound. And a proof
  carrying a braid lives at most `BRAID_REVOCATION_BOUND_MS`, not `AUTHORIZATION_MAX_AGE_MS` (five minutes),
  so a long-lived read, such as a live subscription, re-mints rather than reading on with a proof minted
  before the removal. Expiry is checked on every query, not only when `.as()` is called.
- **A revoke is durable before the epoch moves** (ADR-166 §6). The store records the revoke and marks the
  row, then bumps the organisation's epoch. A bump that fails reports the change as failed, so the caller
  repeats it; the repeat moves the epoch without revoking twice, and meanwhile the cached snapshot ages out
  within the bound. Today the bump swallows Redis failures; reporting them is fixed for every grant, not
  only braids.

### 9. Enterprise, and leaving it

Every route that writes a braid, a signing key or the organisation setting, and the preview, declares
`withEntitlement("enterprise", { feature: "BRAIDS" })` and refuses 402 `enterprise_plan_required` below
Enterprise; the lists stay open (§2). Most of these routes are scoped to a project, and the door reads
that project's organisation for the plan gate (today a project-scoped plan gate throws). The screen shows
what Braids does and offers a conversation. After a downgrade, braids **pause** and are kept (decided by
Alex, 2026-10-21): the trace module, which owns the merged read, asks `EntitlementApi` (cached per
organisation) before honouring `span` braids; the rows stay, and an upgrade shows them again. Authz never
asks entitlement (record §7, "Plans").

### 10. Order of work

| #   | Release 1 package                                                                         | Owner                |
| --- | ----------------------------------------------------------------------------------------- | -------------------- |
| 0   | This ADR, the ADR-177 revision note, the specs                                            | authz, trace         |
| 1   | Conditions compiler and the fence's rendering of `span` windows (§3)                      | authz, framework     |
| 2   | The braid door: grant shape, source, `braids:manage`, a target per project, refusals (§2) | authz, framework     |
| 2b  | The organisation setting keeping braids to organisation admins (§2)                       | authz                |
| 3a  | Merged detail read: TraceApi takes the proof, per-owner match, privacy per owner (§5)     | trace                |
| 3b  | Trace view: badges, ancestors, disabled actions, header totals (§5)                       | trace browser        |
| 4   | Braids screen and dialog; preview and test a trace (§7)                                   | authz browser, trace |
| 5   | Read audit generalised to shared grants (§8)                                              | authz                |
| 6   | Revocation: braid proof lifetime, failed bumps reported, expiry per query (§8)            | authz, framework     |
| 7   | Signing keys, verification at ingest, `Verified()` (§4)                                   | api-key, trace       |
| 8   | SDK helper (TypeScript, Python, Go) and the public docs                                   | sdks, docs           |

Release 2: `ChangeGrant` (read first, write a release later); owner-only traces in the reader's list, with
summaries recomputed for visible spans before sort and paging, against stated performance targets; the
`trace` type ("the whole trace when any span matches"), which needs a guard-approved query shape; wider
OTTL (`or`, `not`, `IsMatch`, typed comparisons). Release 3: evaluations on braided spans, as an explicit
per-braid option.

## Constants

| Name                               | Value                            | Purpose                                                                                    |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `GRANT_SOURCE_BRAID`               | `"braid"`                        | added to `GRANT_EVENT_SOURCES`                                                             |
| `BRAID_PERMISSION`                 | `"braids:manage"`                | create, change or remove a braid, and manage signing keys; in the admin role's additions   |
| `BRAID_CONDITION_TYPE`             | `"span"`                         | the only condition type a braid writes in release 1                                        |
| `BRAID_ENTITLEMENT_FEATURE`        | `"BRAIDS"`                       | `withEntitlement("enterprise", { feature })`                                               |
| `BRAID_CONDITION_COMPILER_VERSION` | `1`                              | stored with `compiledWhere`; part of every fence cache key                                 |
| `BRAID_CONDITION_MAX_LENGTH`       | `1000` characters                | longest condition text one braid may hold                                                  |
| `BRAID_CONDITION_MAX_TERMS`        | `16`                             | comparisons in one condition                                                               |
| `BRAID_CONDITION_MAX_DEPTH`        | `4`                              | nested parentheses in one condition                                                        |
| `BRAID_MAX_DISTINCT_CONDITIONS`    | `50`, confirmed by the size test | distinct compiled predicates one reader's proof may hold                                   |
| `BRAID_PREVIEW_WINDOW_MS`          | 7 days                           | the preview's look-back over the reader's traces                                           |
| `BRAID_REVOCATION_BOUND_MS`        | `30000`                          | a removed braid stops showing within this; also the longest a proof carrying a braid lives |
| `ADMIN_WORKSPACE_VIEW_DEDUP_MS`    | `300000`, reused                 | read audit dedup per actor, reader and owner                                               |
| `SIGNING_KEY_ROTATION_OVERLAP_MS`  | 7 days                           | the old key keeps verifying after a rotation                                               |
| `VERIFIED_ATTRIBUTE_PREFIX`        | `"langwatch.reserved.verified."` | verified marks; never in `RESERVED_ATTRIBUTE_PASSTHROUGH`                                  |

## Invariants

| Invariant                             | Meaning                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Only matching spans leave the owner   | An owner span that fails the condition, or falls outside the window, is never read for the reader |
| Only into the reader's own traces     | An owner trace with no span in the reader is never listed or opened from the reader in release 1  |
| A `span` window opens only span reads | A braid never widens a trace list, summary, analytics or log read (v4.9)                          |
| No forged verified mark               | A client-sent `langwatch.reserved.verified.*` is stripped; only verification at ingest writes one |
| A signature is bound to its trace     | A signature copied into another trace does not verify; within its trace it travels down the chain |
| Braid writes are serialised by reader | Concurrent writes into one reader run one at a time; a change replaces the braid it names or none |
| Nobody braids past their reach        | The writer holds `braids:manage` on the owner and `traces:view` on the reader, asked at the door  |
| Braids do not chain                   | No proof carries a grant whose principal is another project                                       |
| Each span keeps its owner's privacy   | A braided span is never shown under the reader's looser policy                                    |
| Same organisation, no aggregates      | Every braid joins two plain projects of one organisation                                          |
| A removal shows within the bound      | No read, a held proof included, shows a removed braid's spans after `BRAID_REVOCATION_BOUND_MS`   |
| A failed bump is reported, not hidden | A removal whose epoch bump failed is durable, reported as failed, and completed by repeating it   |
| Values are parameters                 | No literal or key from a condition appears in statement text                                      |

## Gates

| Path                                             | Reversible?                 | Blast radius                     | Required gate                                                                                           |
| ------------------------------------------------ | --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Second legal foreign placement in the refinement | No: grants are ledger facts | Large: security boundary         | Human review, and the refinement's refusal tests for every other shape                                  |
| Compiler and the fence's rendering               | Yes                         | Large: tenant and content leak   | Parameter-binding test (no condition text in SQL), latest-version test, largest-legal-proof size test   |
| Reader lock and change order                     | Yes                         | Medium: duplicate or lost braids | Concurrent-create, concurrent-change, same-second change and failed-attach tests                        |
| `braids:manage` in the admin role                | Yes                         | Medium: data shared across teams | Door tests: a member is refused; a team admin of the owner who cannot read the reader is refused        |
| The organisation setting                         | Yes                         | Medium: data shared across teams | With it on, no team or project binding confers `braids:manage`; turning it on applies within the bound  |
| Braid proof lifetime                             | Yes                         | Large: access after removal      | A proof minted before a removal reads no braided span once the bound passes                             |
| Detail read keeps braids                         | Yes                         | Large: cross-project content     | "only matching spans leave the owner" integration test per read; aggregates still narrow to one member  |
| Privacy per owning project                       | Yes                         | Large: personal data             | Test with a strict owner and a loose reader in one trace                                                |
| Verification at ingest                           | Yes                         | Medium: a forged condition match | Forged-mark strip test, cross-trace replay test, revoked-key test                                       |
| Signing key and setting table migrations         | Yes                         | Small                            | Tested down paths (drop table)                                                                          |
| A failed epoch bump is reported                  | Yes                         | Medium: every grant change       | Unit test with a failing epoch store: the revoke is durable, reported as failed, and a repeat completes |

## Schema

```prisma
model Grant {
  // ...
  /// ADR-183: a braid's condition gains `compiledWhere` ({ version, tree }) beside `where`.
  /// Shape: { type: "trace" | "span" | "log", where?, compiledWhere?, from?, until? }.
  condition Json?
}

/// ADR-183: a project's key for signing the tags on its calls. Owned by the API key module.
model SigningKey {
  id               String    @id
  organizationId   String
  projectId        String    // the calling project, whose calls the key signs
  name             String
  publicId         String    @unique // carried in baggage beside the signature
  secretCiphertext String    // encrypted by the process encryption store; never returned by a query
  createdByUserId  String
  createdAt        DateTime  @default(now())
  rotatedAt        DateTime? // set on the key a rotation replaced
  verifiesUntil    DateTime? // end of the rotation overlap
  revokedAt        DateTime?
  lastUsedAt       DateTime?

  @@index([projectId])
  @@index([organizationId])
}

/// ADR-183: an organisation's braid setting. Owned by authz; read into the organisation's snapshot.
model AuthzOrganizationPolicy {
  organizationId               String   @id
  braidsOrganizationAdminsOnly Boolean  @default(false)
  updatedByUserId              String
  updatedAt                    DateTime @updatedAt
}
```

`Grant.condition` is JSON already, so the braid shape needs no migration; the condition schema gains the
optional `compiledWhere`. `SigningKey` and `AuthzOrganizationPolicy` are new tables, each with a
drop-table down path; an organisation with no row has the setting off. The new source and
grant shape need no event version and no upcast, but an older worker would refuse an event it cannot parse:
the schemas that read `braid` and `compiledWhere` ship one release before any route writes them.

## Rejected alternatives

- **Copy the spans into the reader.** Data is stored once (ADR-177); a copy would need its own deletion,
  retention and billing paths, and revocation could not take it back.
- **Reuse share links or `traces:share`.** A share link is a token for one trace to an audience outside the
  project; members hold `traces:share`. A braid is standing access between two projects, decided by an admin.
- **Organisation admins only (`organization:manage`) for everyone.** The draft's choice; Alex decided
  project admins braid their own projects, and an organisation may still choose admins only (§2).
- **`braids:manage` on both projects.** Across teams that means someone admin of both, in practice an
  organisation admin, which undoes the decision. Read access on the reader, with its admins free to remove
  the braid, gives the reader a say without making it a second approval.
- **One braid per pair.** Several read as their union in the fence without `or` in the condition language;
  Alex chose several.
- **A new "trace viewer" role.** It touches four hard-coded places; the `span` window gives the same safety,
  because a span window cannot open a trace or analytics read (v4.9).
- **The whole trace when any span matches (`trace` type) in release 1.** It shows spans that do not match,
  by design, and needs a same-trace subquery the tenant guard refuses today. Release 2.
- **Owner-only traces in the reader's list in release 1.** The list reads a per-project summary; listing
  traces the reader never recorded means recomputing summaries for visible spans before sort and paging.
  Release 2, with performance targets.
- **The strictest policy across both projects** (ADR-177 decision 9). It over-redacts the reader's own spans
  and evaluates the viewer on the wrong project. Per-span, per-owner is exact.
- **Compile OTTL in the Go `ottlserver`.** It evaluates the log context in the gateway and emits no SQL;
  authz's portable engine is where ADR-166 §4 puts the grant compiler.
- **Sign with the project API key.** The legacy key is never read or rotated (record §10).
- **A `braid` module.** A braid is a grant and authz owns the ledger; a module holding no table would only
  forward to `AuthzApi`.
- **`ChangeGrant` in release 1.** An older worker would ignore a narrowing; the event ships in release 2,
  read support first.

## Consequences

- ✅ An orchestrator sees its calls all the way down, with nothing copied and nothing written across tenants.
- ✅ The OTTL compiler, the `span` fence and the per-owner privacy read are shared primitives: aggregates,
  the Developer seat's shared project (ADR-171) and release 2's `trace` type reuse them.
- ✅ Signed calls make "the orchestrator made this call" a fact the platform checked, not a tag anyone in
  the organisation could set.
- ⚠️ The detail read is no longer one project, so every per-span path (offloaded bodies, privacy, actions)
  must carry the span's owner. Missing one is a cross-project read.
- ⚠️ Header totals on a braided trace differ from its list row, which keeps the reader's own totals; the
  header says so.
- ⚠️ The reader's list, search and analytics do not see braided spans in release 1.
- ⚠️ A team admin can show their team's spans to another team whose traces they can read, without an
  organisation admin. Both projects list the braid, the audit log records it, and the reader's admins can
  remove it. An organisation that does not want this keeps braids to its admins.
- ❌ Members of the reader see the owner's matching spans without being members of the owner. That is the
  feature; the dialog names how many people will see them, and every read is audited.

## Open questions

1. **Expiry choices** in the dialog: never, 30 days, 90 days, a date. Owner: product.
2. **Badge placement:** every braided span, or only the top span of each braided branch. Owner: product.

## Revisions

- v1 (2026-10-21): drafted from the internal design, a customer proposal and a five-reviewer cross review.
  Decided by Alex: Enterprise only; signing in release 1 with a polished screen; evaluations not shared in
  either direction; the name Braids. Proceeding on the review's recommendation unless overruled: braids
  only into traces the reader already has; the owning project's policy per span; everything outside the
  trace view stays the project's own; aggregates on neither side.
- v1.1 (2026-10-21, after an independent review against the code, no decision of Alex's changed). A
  proof carrying a braid lives at most the revocation bound, since a proof otherwise lives five minutes
  and checks no epoch. A revoke is durable before the epoch moves, so a failed bump is reported and
  repeated, never rolled back. Braid grants take fresh ids, as shared attaches do today, and every braid
  write is serialised per pair; a change attaches before it revokes. The preview declares both projects at
  the door rather than checking the reader in its service. Listing is open to both projects' members and
  survives a downgrade. The audit is one entry per grant event. Condition size is bounded per condition as
  well as per reader. A signature's boundary is the trace, down the whole call chain. A braided span whose
  parent was not braided shows at the top of the trace, since placing it lower would read spans that were
  not braided.
- v1.2 (2026-10-21, Alex's answers to the first open questions). After a downgrade braids pause and are
  kept. Several braids may join one pair and read as their union; only an identical live braid is refused,
  writes are serialised per reader, and a change of a braid changed meanwhile is refused. Project admins
  braid out of their own projects through a new `traces:braid` in the admin role; since project roles come
  from teams, the door also asks read access on the reader, and either side's admins may remove a braid.
  "Data from" may reach back before the braid was made. Signing keys are managed by whoever can braid,
  with the same permission at the key's project.
- v1.3 (2026-10-21). Alex confirmed the permission's shape: `traces:braid` in the admin role, read access on
  the reader asked at the door, removal from either side. Alex also added an organisation setting, in
  release 1, that keeps braids to organisation admins: authz owns it, and when it is on only
  organisation-wide bindings confer `traces:braid`.
- v1.4 (2026-10-21, implementation notes from mapping the code, no decision of Alex's changed). The
  permission is `braids:manage`, a resource appended last, because the registry is append-only. Signing
  secrets are encrypted by the process's `encryption` store, since `@langwatch/secrets` holds no cipher.
  Conditions render through a marker of their own on the outer select, since the latest-version subquery
  carries the tenant marker too. The signed-call wire format is fixed (§4). The door reads a project's
  organisation for a project-scoped plan gate.
