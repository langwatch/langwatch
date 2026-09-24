/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import { describe, expect, it, vi } from "vitest";

import { DefaultGovernanceCliTokenRevocationService } from "../cli-token-revocation.service.ts";

describe("CliTokenRevocationService.revokeForUser", () => {
  describe("when a person is deactivated", () => {
    it("asks auth to revoke every CLI token they hold and answers its count", async () => {
      const revokeCliTokens = vi.fn<AuthApi["revokeCliTokens"]>(async () => ({ revokedCount: 2 }));
      const service = DefaultGovernanceCliTokenRevocationService.create({
        auth: createApiFixture<AuthApi>({ revokeCliTokens }),
      });

      const result = await service.revokeForUser({ userId: "usr-revoke-active" });

      expect(result).toEqual({ revokedCount: 2 });
      expect(revokeCliTokens).toHaveBeenCalledWith({ userId: "usr-revoke-active" });
    });
  });
});
