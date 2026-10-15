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

| Question                  | Ruling                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Who can get one           | Only a person holding ops permissions on LangWatch Cloud, checked by Cloud on every issue                                     |
| How haven is trusted      | The developer signs haven in to Cloud once; the stored token is limited to issuing testing licences, nothing else they may do |
| When does an instance ask | Only when a developer asks for a gated feature (a haven flag or command), never on every boot                                 |
| How long it lasts         | Picked when asked; default 5 days, at most 30; haven renews it before expiry while signed in                                  |
| What it covers            | One local organization on one instance; Enterprise features; 10 full and 10 Lite seats; no hosted services, commit or overage |
| CI                        | Its own service principal holding the same narrow right, kept in protected CI secrets; never a person's token                 |
| New operations            | `LicensingApi.issueTestingLicense` and `EnterpriseOpsApi.issueTestingLicense` (the ops door and audit)                        |
| Which builds accept it    | Source and release builds alike, verifying the same way                                                                       |

Everything else reuses existing operations: sync, reissue and revoke, and the list and detail
reads. The sign-in reuses the `langwatch` CLI's browser sign-in if it fits; a token limited to one
operation is the gap to fill if access tokens cannot be limited that way today.

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
