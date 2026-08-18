/**
 * Who migrates when (specs/rbac/in-place-authz-migration.feature).
 *
 * One knob, read from the process environment per pass (not the env schema -
 * an internal, temporary rollout knob, same posture as AUTHZ_V2_SHADOW), and
 * it is honoured on EVERY deployment shape. What differs between cloud and
 * self-hosted is only what an UNSET knob means:
 *
 *   unset / ""      the deployment's default - nothing on cloud (we pace it
 *                   ourselves), everything self-hosted (the whole point of
 *                   in-place migration is that a self-hosted operator never
 *                   learns it happened)
 *   "none"          nothing migrates. This is the self-hosted OPT-OUT: an
 *                   operator who wants to stay on the legacy path has a way
 *                   to say so, which is what an unconditional `true` denied
 *                   them.
 *   "all"           everything migrates
 *   "org1,org2"     exactly these organizations
 *
 * Setting the knob therefore means the same thing everywhere: an explicit
 * cohort, taken literally. Leaving it unset changes nothing about how either
 * deployment behaved before.
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
  const trimmed = cohort?.trim() ?? "";
  if (trimmed === "") return !isSaaS;
  if (trimmed === "none") return false;
  if (trimmed === "all") return true;
  return trimmed
    .split(",")
    .map((id) => id.trim())
    .includes(tenantId);
}
