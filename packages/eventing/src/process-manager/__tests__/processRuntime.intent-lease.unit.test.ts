import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  IntentContext,
  ProcessManagerDefinition,
} from "../../pipeline/processManagerDefinition.ts";
import { buildIntentHandlers } from "../processRuntime.ts";

describe("buildIntentHandlers", () => {
  describe("given a leased delivery", () => {
    it("tells the intent's executor when the lease lapses, so paid work can bound itself", async () => {
      const run = vi.fn(async (_payload: { id: string }, _context: IntentContext) => {});
      const config: ProcessManagerDefinition["config"] = {
        name: "leased",
        state: {},
        handlers: {},
        eventTypes: [],
        intents: { judge: { schema: z.object({ id: z.string() }), run } },
      };

      await buildIntentHandlers(config).judge!({
        message: {
          processName: "leased",
          projectId: "project-1",
          processKey: "key-1",
          tenantId: "project-1",
          messageKey: "leased:1",
          intentType: "judge",
          payload: { id: "run-1" },
          sourceEventId: null,
          attempt: 1,
          leaseExpiresAt: 45_000,
        },
      });

      expect(run).toHaveBeenCalledWith(
        { id: "run-1" },
        expect.objectContaining({ attempt: 1, leaseExpiresAt: 45_000 }),
      );
    });
  });
});
