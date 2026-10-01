// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
const ENV_VAR = "DEMO_ORG_IDS";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** No allowlist, no seeding: there is no implicit allow-all. Main's `parseDemoOrgIdsEnv`. */
export function parseDemoOrgIds(rawValue: string | undefined): string[] {
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new Error(`${ENV_VAR} is not set. Demo seeding refuses to run without an allowlist.`);
  }
  const ids = rawValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new Error(`${ENV_VAR} is set but contains no usable ids after trimming.`);
  }
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) {
      throw new Error(
        `${ENV_VAR} contains malformed id ${JSON.stringify(id)}. Each id must match ${ID_PATTERN}.`,
      );
    }
  }
  return [...new Set(ids)];
}

export function assertDemoOrgAllowed(organizationId: string, allowlist: readonly string[]): void {
  if (!allowlist.includes(organizationId)) {
    throw new Error(
      `Organization id ${JSON.stringify(organizationId)} is not in the demo allowlist. ` +
        `The seeding system refuses to touch it. If this is a new demo org, add its id to ${ENV_VAR}.`,
    );
  }
}
