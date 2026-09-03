-- Who really did it, when that is not the person the row already names.
--
-- Under an impersonation `getServerAuthSession` rewrites the session's
-- `user.id` to the SUBJECT — the customer whose access an operator is
-- borrowing — so `audited()` wrote the operator's act against the customer.
-- An operator granting a permanent way into an organization appeared, in the
-- only durable record of it, to be a member of that organization. The
-- authorization decision names both people (D06); the audit row did not.
--
-- Additive and nullable, and nothing is backfilled: NULL means "the actor is
-- the user named", which is true of every row written before this and of
-- every ordinary request after it. Nobody is signed out and nothing is
-- rewritten.
--
-- To roll back, uncomment and run manually. Dropping it loses the actor on
-- rows written since deploy; `userId` keeps naming the subject.
-- DROP INDEX "AuditLog_actorUserId_idx";
-- ALTER TABLE "AuditLog" DROP COLUMN "actorUserId";

ALTER TABLE "AuditLog" ADD COLUMN "actorUserId" TEXT;

-- "What did this operator do", which is the question an incident asks.
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
