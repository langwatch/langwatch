# ADR-189: `Account.issuer` is LangWatch's issuer namespace, not better-auth's key

**Date:** 2026-10-28

**Status:** Accepted

## Context

better-auth 1.7.0 to 1.7.2 keyed an account row by `(issuer, accountId)`. We added
`Account.issuer` and `Identifier.issuer` for it (migration `20260825030000_account_issuer`),
pinned the generic OAuth providers' `accountIssuer` to `local:oauth:<provider>`, and taught
identity's storage branch and single sign-on resolution to read a subject by its issuer.

better-auth 1.7.3 went back to the 1.6 key, `(providerId, accountId)`, removed
`accountIssuer`, and no longer writes an issuer. We move to 1.7.7 for the critical
advisory GHSA-965c-763c-88jm. `(provider, providerAccountId)` has been unique on `Account`
all along, so better-auth finds every existing row.

A subject is unique only within an issuer. Every configured provider id has exactly one
issuer at a time, so the provider id stands in for it, except when a single sign-on
connection is pointed at another identity provider. Then the library would find the old
row by `(connection, subject)` and sign the new provider's user in as the old row's person.
With 1.7.1 the same case failed on the unique constraint.

## Decision

1. better-auth's key is `(providerId, accountId)`. We set no account key option.
2. `Account.issuer` stays, as our column. better-auth declares it as an additional field
   that is never input. The account create hook stamps every new row with the value 1.7.1
   wrote: an issuer the row already states (a confirmed link proposal), else the issuer the
   single sign-on assertion was verified under for that exact subject, else a Microsoft ID
   token's tenant issuer, else `local:credential`, `https://accounts.google.com` or
   `local:oauth:<provider>`. The identifier attach states the same value.
3. Identity's single sign-on resolution refuses a subject whose row at this connection
   was stored under another issuer, as `OAuthAccountNotLinked`, before anything links it.
   It reads the subject's `Account` rows and its live `Identifier` rows, because the callback
   finds a finalized person's account through the identifier before the fold projects the row.
   Only the same issuer, with or without a trailing slash, passes. Connection rows are written
   after the issuer column, so a connection row with no issuer or a `local:` namespace is
   refused too. An assertion that names no issuer is refused outright: its row could only be
   stamped with a `local:` namespace.
4. A generic OAuth provider that must verify ID tokens and has no signing keys is left
   unmounted at startup with the reason logged, as the resilient wrapper already did. The
   rest of sign-in stays up; 1.7.1 failed the whole auth context instead.

No migration. Existing rows keep the issuer they carry and stay findable.

## Consequences

- A connection whose identity provider changes issuer refuses its existing subjects until
  their rows are re-linked. 1.7.1 failed those sign-ins too, on the unique constraint.
- Microsoft is not guarded: better-auth keys its rows by the `oid` claim, not `sub`
  (`(microsoft, oid)` in 1.7.7; 1.7.1 also keyed the tenant issuer). Microsoft assigns
  `oid`, so no tenant can choose one that collides with another tenant's. Its rows still
  carry the tenant issuer identity reads.
- The issuer-keyed account query shape in identity's storage branch is no longer issued by
  better-auth. It is left in place and can go once 1.7.7 has run in production.

Spec: `specs/identity/account-issuer-namespace.feature`.
