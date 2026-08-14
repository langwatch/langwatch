-- One config per scope for default models.
--
-- The "+ Add config" save path used to insert a new ModelDefaultConfig
-- without checking whether the scope already had one. Each save at the
-- same scope stacked one more row. The resolver hid the problem: it
-- tiebreaks same-scope configs by createdAt DESC, so only the newest
-- config had any effect while every duplicate row rendered the same
-- resolved values in the settings table.
--
-- The write path now claims each scope on save (the scope moves to the
-- new config and the old attachment is removed). This migration applies
-- the same rule to rows written before the fix:
--
--   1. For every (scopeType, scopeId) held by more than one config,
--      keep the attachment whose config is newest by (createdAt, id)
--      and delete the shadowed attachments. This matches the resolver's
--      tiebreak, so resolution results do not change.
--   2. Delete configs left with zero attachments. They cannot be
--      reached by the resolver and only clutter the settings table.

DELETE FROM "ModelDefaultConfigScope" s
USING "ModelDefaultConfig" c
WHERE s."configId" = c."id"
  AND EXISTS (
    SELECT 1
    FROM "ModelDefaultConfigScope" s2
    JOIN "ModelDefaultConfig" c2 ON c2."id" = s2."configId"
    WHERE s2."scopeType" = s."scopeType"
      AND s2."scopeId" = s."scopeId"
      AND (
        c2."createdAt" > c."createdAt"
        OR (c2."createdAt" = c."createdAt" AND c2."id" > c."id")
      )
  );

DELETE FROM "ModelDefaultConfig" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "ModelDefaultConfigScope" s
  WHERE s."configId" = c."id"
);
