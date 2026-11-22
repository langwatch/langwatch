/**
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { gatewayUpdateVirtualKeySchema } from "../gateway-platform.schemas.ts";
import { virtualKeyApiUpdateInputSchema } from "../virtual-key.schemas.ts";

describe("a virtual key update's config", () => {
  describe("when the update names one section", () => {
    /** @scenario Updating one config section keeps every other section of the key's config */
    it("parses to that section alone on the REST wire", () => {
      const parsed = gatewayUpdateVirtualKeySchema.parse({
        config: { fallback: { maxAttempts: 2 } },
      });

      expect(parsed.config).toEqual({ fallback: { maxAttempts: 2 } });
    });

    it("parses to that section alone on the tRPC input", () => {
      const parsed = virtualKeyApiUpdateInputSchema.parse({
        organizationId: "org_1",
        id: "vk_1",
        config: { rateLimits: { rpm: 30 } },
      });

      expect(parsed.config).toEqual({ rateLimits: { rpm: 30, tpm: null, rpd: null } });
    });
  });

  describe("when the update names an empty provider list", () => {
    it("reads it as every provider, as a create does", () => {
      const parsed = gatewayUpdateVirtualKeySchema.parse({ config: { providersAllowed: [] } });

      expect(parsed.config).toEqual({ providersAllowed: null });
    });
  });
});
