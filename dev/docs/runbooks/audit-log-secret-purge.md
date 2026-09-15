# Purging credentials already written to the audit trail

One-off remediation for security finding H2 (2026-09-04 feature-surface pass).
Nothing here has been run against any database.

## What happened

`AuditLog.args` stores a mutation's input. Redaction was keyed by tRPC action
path and named only `secrets.create` and `secrets.update`, so every other
mutation carrying a credential in a plain field wrote it verbatim. The one that
matters most is `license.generate`, whose `privateKey` input is the **licence
signing private key** — the root of trust for all licensing. `license.upload`'s
`licenseKey`, itself a bearer entitlement, has the same shape.

The code fix (`packages/api/src/trpc/trpc-audit-redaction.ts`) closes the class:
a field-name rule now runs for every action at every depth, alongside the
per-action lists. It only governs rows written from now on. Rows already
written still hold plaintext, and `AuditLog` is readable by anyone with
audit-log access.

## Order of work

1. **Rotate first, purge second.** Treat every signing key passed to
   `license.generate` before this change as disclosed. Rotating is what makes
   the exposure stop mattering; the purge is hygiene on top of it. Licences
   already minted under the old key stay valid, so plan the rotation with the
   grandfather branch H14 describes.
2. **Count before deleting**, so the purge can be shown to have run over the
   rows it was meant to:

   ```sql
   SELECT action, count(*), min("createdAt"), max("createdAt")
   FROM "AuditLog"
   WHERE args ?| array['privateKey','licenseKey','sharedSecret','apiKey',
                       'password','clientSecret','accessToken','signingKey']
   GROUP BY action ORDER BY 2 DESC;
   ```

3. **Redact in place rather than deleting the row.** The audit record — who
   did what, when, against which organization — is the part worth keeping; only
   the value has to go.

   ```sql
   UPDATE "AuditLog"
   SET args = args
     || jsonb_build_object('privateKey', '[redacted]')
   WHERE args ? 'privateKey';
   ```

   Repeat per field name, or drive the same list as the `?|` above. Run it in
   batches by `createdAt` window on a production-sized table.

4. **Re-run the count.** It must return zero rows for the fields purged.

## Where it runs

There is no scheduled task for this and there should not be: it is a one-off
against a table no feature writes to except the audit middleware. Run it as an
ops task under the same approval a data-fix migration takes, from the
deployment's own psql session — not from application code, which has no reason
to hold a statement that rewrites audit history.
