/**
 * The application seam. `LangyApp` is what a transport holds, and every method
 * on it must land on one flat `LangyService` call — never on a subordinate
 * capability reached through a property. The recorder below is a Proxy, so a
 * hop through `langy.conversations` would be recorded as `conversations`
 * rather than passing silently.
 */
import type { LangyService } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";
import { LangyApp } from "../langy.app";

function recordingLangyService(): { service: LangyService; reached: string[] } {
  const reached: string[] = [];
  const service = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        reached.push(property);

        return () => Promise.resolve(null);
      },
    },
  ) as LangyService;

  return { service, reached };
}

const CONVERSATION = {
  projectId: "project_1",
  conversationId: "conversation_1",
  userId: "user_1",
};

describe("LangyApp", () => {
  describe("given an application holding one contract LangyService", () => {
    describe("when a transport lists conversations, reads events, or opens one", () => {
      /** @scenario "application transports use the flat contract" */
      it("calls the matching flat service method and reaches no subordinate property", async () => {
        const { service, reached } = recordingLangyService();
        const app = LangyApp.create({ langy: service });

        await app.listPage({ projectId: "project_1", userId: "user_1", limit: 10 });
        await app.eventsAfter({ ...CONVERSATION, after: undefined! });

        expect(reached).toEqual(["getPage", "getEventsAfter"]);
        for (const subordinate of ["conversations", "turns", "messages", "credentials"]) {
          expect(reached).not.toContain(subordinate);
        }
      });

      /** @scenario "transports share one Langy capability" */
      it("delegates to the one instance it was composed with", async () => {
        const { service, reached } = recordingLangyService();
        const app = LangyApp.create({ langy: service });

        expect(app.langyService).toBe(service);

        await app.listPage({ projectId: "project_1", userId: "user_1", limit: 10 });

        expect(reached).toEqual(["getPage"]);
      });
    });
  });
});
