// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { MemoryNurturingClaimRepository } from "../memory.nurturing-claim.repository.ts";

describe("MemoryNurturingClaimRepository", () => {
  describe("when a key is claimed twice inside its window", () => {
    it("grants the first claim and refuses the second", async () => {
      const claims = MemoryNurturingClaimRepository.create();

      expect(await claims.claim("nurturing:a", 60)).toBe(true);
      expect(await claims.claim("nurturing:a", 60)).toBe(false);
    });

    it("keeps other keys independent", async () => {
      const claims = MemoryNurturingClaimRepository.create();

      await claims.claim("nurturing:a", 60);

      expect(await claims.claim("nurturing:b", 60)).toBe(true);
    });
  });
});
