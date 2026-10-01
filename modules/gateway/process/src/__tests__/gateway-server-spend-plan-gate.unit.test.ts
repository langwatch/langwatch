import { recordOrganizationCredential } from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * ADR-072: the spend-plan gate reads the organization a spend route's door
 * resolved off the raw request, never a context variable no door here sets.
 */
import { describe, expect, it } from "vitest";

import { gatewaySpendPlanOrganizationId } from "../gateway.module.ts";

describe("gatewaySpendPlanOrganizationId", () => {
  /** @scenario The spend-plan gate reads the credential door's own organization */
  it("reads the organization the credential door recorded for the request", () => {
    const request = new Request("https://gateway.test/api/gateway/v1/spend-events");
    recordOrganizationCredential(request, {
      type: "apiKey-org",
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(gatewaySpendPlanOrganizationId({ req: { raw: request } })).toBe("org-1");
  });

  /** @scenario The spend-plan gate refuses to gate on a blank organization */
  it("throws rather than gating on a blank organization when no door ran", () => {
    const request = new Request("https://gateway.test/api/gateway/v1/spend-events");

    expect(() => gatewaySpendPlanOrganizationId({ req: { raw: request } })).toThrow(
      "this request's door resolved none",
    );
  });
});
