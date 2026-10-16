# ADR-180: Developer testing licenses are real licenses issued to signed-in Cloud staff

**Date:** 2026-10-15

**Status:** Accepted

## Context

Local development and CI unlock licence-gated features through shortcuts: haven generates an RSA
pair and signs licences on the laptop (`tools/thuishaven/app/licencekeys.go`), the storage seed
signs an Enterprise licence or installs a committed test licence
(`apps/tasks/src/storage-seed/seed-license.ts`), `LANGWATCH_LICENSE_PUBLIC_KEY` swaps the trust
root (`enterprise/modules/licensing/process/src/rules/license-verifying-key.rules.ts`), licences
carry a `devStack` claim, and CI and upgradelab import fixture licences. The licence registry
(ADR-156) also fills with hand-issued "(internal dogfood)" rows that ops pages can only hide by
guessing from the email address.

Every one of these is a second way to hold an entitlement, so every one is a way for the real
path to rot unnoticed. A licence is only needed to test a licence-gated feature: development
inside the open-source plan needs none.

## Decisions

### 1. A testing licence is a real licence, issued to Cloud staff who signed in

A developer who holds ops permissions on LangWatch Cloud signs haven in to their Cloud account once,
in the browser. haven keeps a token that can do one thing: issue testing licences. From then on,
when the developer asks for a gated feature, haven calls Cloud with that token, the instance id and
the local organization id; Cloud checks the caller still holds ops permissions and issues the
licence; haven stores it through the existing upload path. No browser step and no waiting per
licence. A developer without ops permissions on Cloud gets no licence and develops inside the
open-source plan.

The licence is signed by the production key on Cloud. No machine holds a signing key, and no
running stack trusts any key but the embedded production one.

### 2. Rulings

| Question                  | Ruling                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who can get one           | Only a person holding ops permissions on LangWatch Cloud, checked by Cloud on every issue                                                                                                                                                                     |
| How haven is trusted      | The developer signs haven in to Cloud once; the stored personal token can only issue testing licences, and Cloud re-checks their ops permissions on every call                                                                                                |
| When does an instance ask | Only when a developer asks for a gated feature (a haven flag or command), never on every boot                                                                                                                                                                 |
| How long it lasts         | Picked when asked; default 5 days, at most 30; haven renews it before expiry while signed in                                                                                                                                                                  |
| What it covers            | One local organization on one instance; Enterprise features; 10 full and 10 Lite seats; no hosted services, commit or overage                                                                                                                                 |
| CI                        | A service token: a kind of token a person with ops permissions creates in the ops console, named and expiring (default 90 days, at most a year). It acts as the person who made it, so it stops when they lose ops permissions; any ops manager can revoke it |
| New operations            | `LicensingApi.issueTestingLicense`; creating, listing and revoking service tokens through `EnterpriseOpsApi` (the ops door and audit)                                                                                                                         |
| Which builds accept it    | Source and release builds alike, verifying the same way                                                                                                                                                                                                       |

Everything else reuses existing operations: sync, reissue and revoke, and the list and detail
reads.

Every token is a testing-licence token that reaches only `issueTestingLicense` and its own
revocation; no token carries `ops:manage`, so a leaked one can do nothing else. A token always
belongs to the person who made it, and on every call Cloud asks that person's ops permission at
platform scope: one rule, no exception (Alex, 2026-10-15). There are no service accounts: a service
token is a kind of token, not an account. A personal token is minted through the existing CLI
browser sign-in (`/api/auth/cli`), which shows the device's name and requires ops permissions; a
service token is created in the ops console for CI. A person revokes their own token (`haven
logout` does so on Cloud), and an ops manager can revoke any. The registry names the person as the
issuer of every licence; ops screens show names, not ids.

### 3. How a testing licence is marked and bound

- `IssuedLicense.kind` is `standard` or `testing`, default `standard` (an expand migration owned
  by licensing). `source` stays provenance. The local organization the licence is for is stored
  apart from `IssuedLicense.organizationId`, which names the Cloud customer.
- The signed licence gains optional trailing claims `kind: "testing"` and `instanceId`. A missing
  `kind` is a standard licence. A testing licence must carry both, and the instance id and the
  signed organization id are checked on upload and on every entitlement read. Reissue keeps them;
  a testing licence never becomes standard. Older verifiers must refuse the new shape rather than
  accept it without its restrictions.
- The registry row is bound to the instance it was issued for when it is issued. Resetting a
  testing licence's binding is refused: a new instance gets a new licence.

### 4. Expiry and revocation are enforced, for testing licences

Today a self-hosted plan read verifies only the signature, so an expired licence keeps its plan
(`license-plan-source.service.ts`), and single sign-on ignores expiry for the process lifetime
(`license.service.ts`). For a testing licence every entitlement read requires an unexpired,
matching licence, and caches end at expiry. Standard customer licences keep today's policy.

A cached answer about a testing licence lives at most until its expiry and at most 60 seconds, so
a revoked or expired licence stops working within a minute. A testing licence is refused while
`LANGWATCH_CONNECT_INSTANCE_ID` names the instance id: an operator-chosen id would let a copied
licence pass on another machine. A registry row whose `kind` this release does not know is shown
as the raw string and treated like a testing licence wherever the difference matters.

A testing licence syncs hourly (and on boot and on demand) even with no hosted service; a refusal
from the sync clears it. Offline, it lasts until its signed expiry and no longer.

### 5. Seeded local ids are random

The storage seed writes the local organization, team, project and admin user under fixed ids
(`local-dev-organization` and friends, `apps/tasks/src/storage-seed/storage-seed.ts`). A licence
bound to a well-known organization id is valid on every developer's machine, so seeded rows get
random KSUIDs like any other row and the seed finds its rows again by slug and email. Readers of
the fixed ids (the diff tools, the Langy e2e default, tests) resolve them by slug. The slugs and
the instance id, already random per database, are unchanged.

### 6. Ops pages hide testing licences by the kind, not by guessing

Licence and activation lists, install summaries and counts leave out `kind = testing` by default
and show it with a Testing badge when asked. Testing licences never count towards seat invoices,
contract totals or customer onboarding. The email-suffix filter on the licences page is replaced by
this once the kind exists.

### 7. Order of delivery

1. Random seeded ids; the `kind` column, the signed claims and readers that refuse what they cannot
   enforce; expiry enforcement for testing licences.
2. Cloud issues a testing licence to a signed-in caller holding ops permissions; the token limited
   to that one operation; the ops pages show who issued each testing licence.
3. `haven login`, haven asks for and renews licences through it; CI through its service principal.
4. The shortcuts in the context above are deleted, keeping isolated cryptography fixtures for unit
   tests and refusal tests only. Known dogfood licences are reviewed by id and revoked; nothing is
   reclassified by name or email.

## Consequences

- Testing a gated feature needs Cloud ops permissions and one sign-in per machine.
- The licence path developers use is the one customers use, so a break shows up in development.
- Upgrade lanes for releases that cannot enforce the new claims keep their fixtures or retire;
  that is decided when step 4 reaches upgradelab.
- Binding is to the stored instance, not to hardware: a copied database carries its licence until
  expiry. Short lifetimes, server-side binding and quotas bound the harm.
