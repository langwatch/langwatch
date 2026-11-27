/** @see modules/langy/specs/langy-ops-turn-facts.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LangyConversationCommands } from "../../../../eventing/langy-conversation.commands.ts";
import { LangyMemoryStore } from "../../../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyConversationRepository } from "../../../../repositories/memory/memory.langy-conversation.repository.ts";
import { LangyConversationService } from "../langy-conversation.service.ts";

describe("given a project that holds no conversation", () => {
  describe("when its turn facts are read", () => {
    /** @scenario "Turn facts of a conversation the project does not hold are refused as not found" */
    it("refuses with langy_conversation_not_found", async () => {
      const service = LangyConversationService.create({
        commands: createApiFixture<LangyConversationCommands>({}),
        repository: MemoryLangyConversationRepository.create(LangyMemoryStore.create()),
      });

      await expect(
        service.getTurnFacts({ projectId: "p1", conversationId: "c1" }),
      ).rejects.toMatchObject({ code: "langy_conversation_not_found" });
    });
  });
});
