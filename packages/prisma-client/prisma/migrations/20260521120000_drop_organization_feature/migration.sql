-- OrganizationFeature was a per-org allowlist for the old Optimization
-- Studio rollout. Studio is GA for everyone and the table has no
-- remaining runtime consumers, so we retire the model entirely. The
-- replacement is the per-flag postgres feature-flag store added in
-- 20260517120000_add_feature_flag + 20260519120000_feature_flag_targeting_rules.

DROP TABLE IF EXISTS "OrganizationFeature";
