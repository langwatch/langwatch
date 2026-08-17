-- Disable every `copilot_studio` ingestion source.
--
-- That source polled `auditLogs/directoryAudits`, an Entra directory-change
-- feed that has never contained a Copilot interaction and never will. It did
-- not report healthy — `status` defaults to 'awaiting_first_event' and only
-- leaves that state once an event arrives — but that state is
-- indistinguishable from a source created five minutes ago, so these have sat
-- there indefinitely while the admin UI and published docs said otherwise.
--
-- Deliberately NOT repointed at the replacement. `microsoft_365_audit` needs
-- an app registration with a different permission (`ActivityFeed.Read` on the
-- Office 365 Management Activity API, not `AuditLog.Read.All` on Graph) and a
-- client secret that was never persisted for these rows (#6785). Silently
-- rewriting them would produce a source that looks configured and fails to
-- authenticate. An operator re-creates them against the new source type.
--
-- `parserConfig` is left untouched so the tenant/client ids remain readable
-- when the operator sets the replacement up. The reason is appended to
-- `description`, which is operator-facing, rather than overwriting it.
--
-- Idempotent: re-running disables nothing already disabled and cannot
-- double-append the reason. Prisma's ledger means a second run only happens
-- if someone applies this by hand.
--
-- To roll back, uncomment and run manually. This restores the rows to active
-- and they resume polling an endpoint that returns nothing:
-- UPDATE "IngestionSource"
--    SET "status" = 'awaiting_first_event',
--        "description" = NULLIF(
--          regexp_replace("description", E'\n?\\[retired\\][^\n]*', '', 'g'), '')
--  WHERE "sourceType" = 'copilot_studio';

UPDATE "IngestionSource"
   SET "status" = 'disabled',
       "description" = CASE
         WHEN "description" IS NULL OR "description" = ''
           THEN '[retired] Polled an Entra directory-change feed that never returned Copilot interactions. Re-create this source as microsoft_365_audit.'
           ELSE "description" || E'\n[retired] Polled an Entra directory-change feed that never returned Copilot interactions. Re-create this source as microsoft_365_audit.'
       END
 WHERE "sourceType" = 'copilot_studio'
   AND "status" <> 'disabled'
   AND ("description" IS NULL OR "description" NOT LIKE '%[retired] Polled an Entra directory-change feed%');
