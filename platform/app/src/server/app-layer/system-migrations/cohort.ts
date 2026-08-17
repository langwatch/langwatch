/**
 * Who migrates when (specs/rbac/in-place-authz-migration.feature).
 *
 * Self-hosted: everyone, no configuration - the whole point of in-place
 * migration is that a self-hosted operator never learns it happened.
 *
 * Cloud: paced by us through SYSTEM_MIGRATIONS_COHORT, read from the
 * process environment per pass (not the env schema - an internal,
 * temporary rollout knob, same posture as AUTHZ_V2_SHADOW):
 *   unset / "none"  nothing migrates (the cloud default)
 *   "all"           everything migrates
 *   "org1,org2"     exactly these organizations
 */
export function cohortIncludes({
  isSaaS,
  cohort,
  tenantId,
}: {
  isSaaS: boolean;
  cohort: string | undefined;
  tenantId: string;
}): boolean {
  if (!isSaaS) return true;
  const trimmed = cohort?.trim() ?? "";
  if (trimmed === "" || trimmed === "none") return false;
  if (trimmed === "all") return true;
  return trimmed
    .split(",")
    .map((id) => id.trim())
    .includes(tenantId);
}
