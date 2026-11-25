/**
 * @vitest-environment node
 * @see modules/user/specs/user.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryUserDatabase } from "../memory.user.database.ts";
import { MemoryUserRepository } from "../memory.user.repository.ts";

describe("MemoryUserRepository", () => {
  describe("when a mint loses the race for its address", () => {
    /** @scenario "A mint that loses a race for its address answers that the address is taken" */
    it("refuses the second mint of one address as taken", async () => {
      const database = MemoryUserDatabase.create({
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const repository = MemoryUserRepository.create({ database });
      await repository.create({ name: "Ada", email: "ada@example.com" });

      await expect(
        repository.create({ name: "Ada", email: "ada@example.com" }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    });
  });
});
