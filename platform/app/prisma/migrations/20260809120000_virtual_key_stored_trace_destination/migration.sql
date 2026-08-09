-- Give every virtual key a stored trace destination.
--
-- The destination used to be derived on every read: the key's own
-- `traceProjectId`, then its single PROJECT access scope, then the
-- organization's oldest live `internal_governance` project. This backfill
-- answers that chain once, with the same rules, and writes the answer down,
-- so the column becomes the whole story.
--
-- The invariant this establishes: a key's `traceProjectId` names a project
-- of the key's own organization, and is null only when the organization has
-- no live governance project to fall back to. Null keeps taking the path it
-- takes today (the gateway skips span export rather than failing) and the
-- next edit of such a key is refused until somebody gives it a home. The
-- column stays nullable: a NOT NULL would fail the migration on exactly the
-- self-hosted data that cannot satisfy it.
--
-- No key's effective destination moves. Every row written here is the answer
-- the chain was already giving, which is what makes a rolling deploy safe:
-- pods still running the chain read these same rows and agree.
--
-- `revision` and `updatedAt` are deliberately untouched. Nothing about the
-- gateway's view of a key changes, and bumping the revision would make every
-- key in every organization re-fetch its config on the deploy that runs this.
--
-- Idempotent: re-running it is a no-op, because every value it writes
-- satisfies the predicate that would have cleared it.

-- 1. A pointer that no longer names a live project of the key's own
--    organization is not a destination. Resolution already passed over it,
--    so clearing it here is what lets the rules below answer for the key.
UPDATE "VirtualKey" vk
SET "traceProjectId" = NULL
WHERE vk."traceProjectId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Project" p
    JOIN "Team" t ON t."id" = p."teamId"
    WHERE p."id" = vk."traceProjectId"
      AND p."archivedAt" IS NULL
      AND t."organizationId" = vk."organizationId"
  );

-- 2. A key with exactly one PROJECT access scope takes it, when the project
--    it names is live.
--
--    The organization is checked here even though the read-time rule did not
--    check it: a scope row is validated against the organization when it is
--    written, so the two agree on every key the app can produce, and where
--    they would not, storing another tenant's project as this key's
--    destination is the worse of the two answers.
UPDATE "VirtualKey" vk
SET "traceProjectId" = sole."scopeId"
FROM (
  SELECT s."virtualKeyId" AS "virtualKeyId", MIN(s."scopeId") AS "scopeId"
  FROM "VirtualKeyScope" s
  WHERE s."scopeType" = 'PROJECT'
  GROUP BY s."virtualKeyId"
  HAVING COUNT(*) = 1
) sole
JOIN "Project" p ON p."id" = sole."scopeId" AND p."archivedAt" IS NULL
JOIN "Team" t ON t."id" = p."teamId"
WHERE vk."id" = sole."virtualKeyId"
  AND vk."traceProjectId" IS NULL
  AND t."organizationId" = vk."organizationId";

-- 3. Everything still without a destination takes the organization's oldest
--    live governance project, which is where its traces were already going.
--    Ties on `createdAt` break on id so two runs pick the same row.
UPDATE "VirtualKey" vk
SET "traceProjectId" = gov."projectId"
FROM (
  SELECT DISTINCT ON (t."organizationId")
         t."organizationId" AS "organizationId",
         p."id" AS "projectId"
  FROM "Project" p
  JOIN "Team" t ON t."id" = p."teamId"
  WHERE p."kind" = 'internal_governance'
    AND p."archivedAt" IS NULL
  ORDER BY t."organizationId", p."createdAt" ASC, p."id" ASC
) gov
WHERE vk."traceProjectId" IS NULL
  AND vk."organizationId" = gov."organizationId";
