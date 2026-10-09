/**
 * @vitest-environment node
 * @see specs/eventing/memory-outbox.feature
 * The worker's installed list over `memoryStores()`: user's memory repositories append to the
 * process store eventing drains, so a created fact leaves the outbox without a hand drain.
 */
import { UserApi } from "@langwatch/user-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootMemoryWorker } from "./worker-memory-boot.fixture.ts";

let booted: Awaited<ReturnType<typeof bootMemoryWorker>> | undefined;

afterEach(async () => {
  await booted?.runtime.stop();
  booted = void 0;
});

describe("given the worker's installed list booted over memoryStores()", () => {
  describe("when a user is created", () => {
    /** @scenario "A user created on the memory stores records its created fact within one outbox poll" */
    it("dispatches the user's created fact from the shared outbox", async () => {
      booted = await bootMemoryWorker();
      const { stores, runtime } = booted;
      await runtime.start();

      const user = await runtime.service(UserApi).create({ name: "Ada", email: "ada@example.com" });

      await vi.waitFor(
        async () => {
          const messages = await stores.processStore.findMessagesByRef({
            ref: { processName: "userLifecycleFacts", projectId: user.id, processKey: "facts" },
          });
          expect(messages.map(({ intentType, status }) => ({ intentType, status }))).toEqual([
            { intentType: "recordCreated", status: "dispatched" },
          ]);
        },
        { timeout: 5000, interval: 100 },
      );
    });
  });
});
