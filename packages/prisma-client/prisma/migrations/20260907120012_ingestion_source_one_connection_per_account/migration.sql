-- One live connection per provider account and report, held by the database.
--
-- 20260907120010 added the account column and the service compares it on every
-- save: it reads every non-archived connection in the organization, looks for
-- one already reading the account the provider just named for the same report,
-- and refuses with a sentence naming the connection that holds it. That check
-- is what makes the refusal readable, and it is not what makes it true.
--
-- Between the read and the write sits the provider round trip — the account is
-- ASKED FOR while the connection is being saved — plus the destination check
-- and the credential sealing. That window is seconds wide, not milliseconds.
-- Two saves of the same administrator key inside it, two admins or one form
-- submitted twice, both read a set that names neither of them, both pass, and
-- both are stored. Nothing looks wrong afterwards: no row collides, no run
-- fails, and the organization's spend is simply reported twice, once under
-- each connection, with both figures correct on their own. The index below is
-- what makes that state unrepresentable rather than merely unlikely.
--
-- IDENTITY. The same three things the service compares:
--
--   * the organization, because an account id is only unique within one;
--   * the account the provider named, NULL on every connection that names what
--     it reads in its own config instead (Azure by subscription, Power Platform
--     by environment) and on every connection saved before the column existed;
--   * the report, because two reports about one account cannot bill the same
--     money twice — one connection reads token usage, another reads spend, and
--     refusing that pair would leave a customer wanting both having to pick one.
--
-- The report is normalised here exactly as the service normalises it: trimmed,
-- lowercased, and absent-or-blank collapsed to the same key so two connections
-- that both name no report still collide. `jsonb_typeof` reproduces the
-- service's own "a report is a string or it is nothing" rule, so a report
-- stored as a JSON number is not silently compared against the string spelling
-- of itself — the one corner where an expression written in SQL could
-- otherwise disagree with the rule written in TypeScript.
--
-- ARCHIVED ROWS ARE OUT, disabled ones are IN, which is the service's rule and
-- not a simplification of it: only archiving gives an account up. A connection
-- an admin switched off can be switched back on, and the day it is, both start
-- counting the same spend.
--
-- SAFE TO APPLY. "providerAccountId" arrives NULL on every existing row in the
-- migration two before this one and no code has written it yet, so the partial
-- index covers nothing at build time and cannot fail on data already there.
-- Not declared in schema.prisma: Prisma has no partial indexes and no
-- expression indexes, so an `@@unique` for it would drop both on the next
-- `prisma migrate dev` — the same reason "Grant_organizationId_roleKey_live_idx"
-- is undeclarable, and it is recorded in a comment on the model the same way.
--
-- WHAT THE LOSER SEES. The service guard still answers the ordinary case, so
-- this fires only on the genuine race, and the loser of one gets Prisma's
-- P2002 unmapped: a generic failure and a trace id rather than the named
-- refusal. That is the trade ADR-128 already takes for a raced write, and it
-- is the correct side of it — a save refused with poor copy is recoverable,
-- a bill counted twice is not.
CREATE UNIQUE INDEX "IngestionSource_provider_account_report_live_idx"
  ON "IngestionSource" (
    "organizationId",
    "providerAccountId",
    (
      coalesce(
        lower(
          btrim(
            CASE
              WHEN jsonb_typeof("parserConfig" -> 'report') = 'string'
                THEN "parserConfig" ->> 'report'
            END
          )
        ),
        ''
      )
    )
  )
  WHERE "providerAccountId" IS NOT NULL AND "archivedAt" IS NULL;

-- Down
--
-- The index carries no row data of its own, so dropping it loses nothing that
-- has to be rebuilt. What it gives up is the guarantee: the service check goes
-- back to being the only thing between two admins and one bill counted twice,
-- and it cannot see a concurrent save.
--
-- Left commented, like the sibling migrations that carry a Down block. Prisma
-- runs no down step, so an executable one here would be a statement nobody
-- calls; this is the script an operator runs by hand, kept next to the up it
-- undoes.
--
-- DROP INDEX IF EXISTS "IngestionSource_provider_account_report_live_idx";
