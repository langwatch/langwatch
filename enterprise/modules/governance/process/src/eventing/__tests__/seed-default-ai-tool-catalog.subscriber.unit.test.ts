// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { seedDefaultAiToolCatalog } from "../governance-activity-monitor.pipeline.ts";

const created = {
  tenantId: "organization_acme",
  organizationId: "organization_acme",
  organizationName: "Acme",
  occurredAt: 1,
};

function installed() {
  const seeded: string[] = [];
  const handle = seedDefaultAiToolCatalog({
    catalog: {
      aiToolEnsureDefaultCatalog: async ({ organizationId }) => {
        if (seeded.includes(organizationId)) return { hasSeeded: false, created: 0 };
        seeded.push(organizationId);
        return { hasSeeded: true, created: 9 };
      },
    },
  });
  return { handle, seeded };
}

describe("governance's subscriber to lw.organization.created", () => {
  /** @scenario "A newly created organization is given the standard catalog from its creation fact" */
  it("provisions the standard catalogue for the created organization", async () => {
    const { handle, seeded } = installed();

    await handle(created);

    expect(seeded).toEqual(["organization_acme"]);
  });

  /** @scenario "A redelivered organization creation fact provisions no tile twice" */
  it("provisions nothing twice when the fact is delivered again", async () => {
    const { handle, seeded } = installed();

    await handle(created);
    await handle(created);

    expect(seeded).toEqual(["organization_acme"]);
  });
});
