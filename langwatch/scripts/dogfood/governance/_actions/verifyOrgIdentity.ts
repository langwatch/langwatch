/**
 * Trivial first action: verify the target org has a name + slug.
 *
 * This is a read-only action. Its purpose is to exercise the runner +
 * scope-guard wiring end-to-end before any mutation actions land. If this
 * fails, we have an upstream config problem (allowlist points at a row that
 * was archived, soft-deleted, or never had its identity set).
 */

import type { SeedAction, SeedActionContext, SeedActionOutcome } from "../_lib/seedRunner";

export const verifyOrgIdentity: SeedAction = {
  name: "verifyOrgIdentity",
  async run({ organization }: SeedActionContext): Promise<SeedActionOutcome> {
    const missing: string[] = [];
    if (organization.name === null || organization.name === "") {
      missing.push("name");
    }
    if (organization.slug === null || organization.slug === "") {
      missing.push("slug");
    }
    if (missing.length > 0) {
      return {
        status: "failed",
        error: new Error(
          `Demo org ${organization.id} is missing required identity fields: ${missing.join(", ")}`,
        ),
      };
    }
    return {
      status: "succeeded",
      summary: `org "${organization.name}" (slug ${organization.slug}) ready`,
    };
  },
};
