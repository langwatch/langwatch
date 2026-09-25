// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SeedActionOutcome } from "@langwatch/enterprise-seed-demo-contract";

/** Main's `verifyOrgIdentity`: the allowlisted organization must carry a name and a slug. */
export function verifyOrgIdentity(organization: {
  id: string;
  name: string | null;
  slug: string | null;
}): SeedActionOutcome {
  const missing: string[] = [];
  if (organization.name === null || organization.name === "") missing.push("name");
  if (organization.slug === null || organization.slug === "") missing.push("slug");
  if (missing.length > 0) {
    return {
      status: "failed",
      error: `Demo org ${organization.id} is missing required identity fields: ${missing.join(", ")}`,
    };
  }
  return {
    status: "succeeded",
    summary: `org "${organization.name}" (slug ${organization.slug}) ready`,
  };
}
