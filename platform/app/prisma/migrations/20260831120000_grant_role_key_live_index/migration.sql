-- An API-key permission check asks who else holds a key's private role:
-- `(organizationId, roleKey)`, fenced on the row not being revoked. Every
-- index on Grant led with organizationId and then went somewhere else
-- (scopeType, principalType, projectId), so for an organization that holds
-- more than a handful of grants the leading column selects everything and
-- there is nothing left to descend. Postgres read every live grant the
-- organization owned, on every check, to return a few rows.
--
-- The fence belongs in the index rather than as a filter over it, for the
-- same reason it does on "Grant_organizationId_scopeType_scopeId_live_idx"
-- (20260820180000_grants_revoke_marks_the_row): every read that decides
-- access excludes marked rows, so an index that still carries them is an
-- index the planner has to filter after descending.
--
-- IF NOT EXISTS is deliberate. A deployment with no CPU headroom can build
-- this ahead of the release with CREATE INDEX CONCURRENTLY - which cannot
-- run here, because Prisma wraps each migration in a transaction - and this
-- statement then becomes the no-op that records the same intent.
CREATE INDEX IF NOT EXISTS "Grant_organizationId_roleKey_live_idx"
  ON "Grant" ("organizationId", "roleKey")
  WHERE "revokedAt" IS NULL;
