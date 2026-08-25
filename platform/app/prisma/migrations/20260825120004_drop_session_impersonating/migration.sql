-- The legacy impersonation payload is gone (D06). Impersonation now rides the
-- {actor, subject} claims added two migrations ago, which is the shape the
-- authz Principal already speaks, so every authorization decision under an
-- impersonation can name both people.
--
-- Dropping the column also settles a disagreement that has stood since the
-- better-auth migration: Prisma declared it `Json?` while better-auth's own
-- session config declared the same field `{ type: "string" }`. Neither side
-- was right about the other, and both die here.
--
-- Safe to run: the migration before this one ended every session that held a
-- value, and nothing reads or writes the column any more.
--
-- To roll back, uncomment and run manually. The column comes back empty - the
-- payloads themselves went with the sessions that carried them.
-- ALTER TABLE "Session" ADD COLUMN "impersonating" JSONB;

ALTER TABLE "Session" DROP COLUMN "impersonating";
