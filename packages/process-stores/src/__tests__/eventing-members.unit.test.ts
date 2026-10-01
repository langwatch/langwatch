/**
 * @vitest-environment node
 */
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { buildEventing } from "../eventing-members.ts";
import { producerEventing } from "../eventing-role.ts";

describe("buildEventing", () => {
  describe("given the producer role", () => {
    /** @scenario "The producer role holds the process store too" */
    it("supplies a process store beside its producer-only event store", async () => {
      const built = buildEventing({
        config: producerEventing({ executionTarget: "web" }),
        processName: "langwatch-api",
        prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      });

      try {
        expect(built.value.processStore).toBeDefined();
      } finally {
        await built.close?.();
      }
    });
  });
});
