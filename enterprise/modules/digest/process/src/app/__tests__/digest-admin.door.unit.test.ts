// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { AdminSurfaceHiddenError, type OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { DigestOperatorsService } from "../../services/digest-operators.service.ts";

const staff: OpsOperator = { id: "user_olive", email: "olive@langwatch.test" };
const outsider: OpsOperator = { id: "user_mallory", email: "mallory@customer.test" };

/** Ops's cloud admin door as it answers: hidden unless on the list and cloud ops is on. */
function serviceWith({ cloudOps }: { cloudOps: boolean }) {
  const ops = createApiFixture<OpsApi>({
    admitCloudAdmin: async (operator) => {
      if (!cloudOps || operator?.id !== staff.id) throw new AdminSurfaceHiddenError();
      return operator;
    },
    admitOperator: async () => undefined,
  });
  return DigestOperatorsService.create({ ops });
}

describe("the digest admin door", () => {
  /** @scenario "The digest admin is refused where cloud ops is off" */
  it("refuses staff on the ops list with not_found where cloud ops is off", async () => {
    await expect(serviceWith({ cloudOps: false }).admitManager(staff)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  /** @scenario "Only operators on the ops list use the digest admin" */
  it("refuses a user off the ops list with not_found", async () => {
    const service = serviceWith({ cloudOps: true });
    await expect(service.admitManager(outsider)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.admitManager(null)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.admitManager(staff)).resolves.toBe(staff.id);
  });
});
