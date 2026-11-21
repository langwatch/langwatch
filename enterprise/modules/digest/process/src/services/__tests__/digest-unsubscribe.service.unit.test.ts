// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The unsubscribe must always work: a failing attempt counter lets the attempt through.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import { DigestUnsubscribeService } from "../digest-unsubscribe.service.ts";

const CALLER = "203.0.113.7";

describe("the digest's unsubscribe service", () => {
  describe("when the attempt counter fails", () => {
    /** @scenario "Unsubscribe still works when the attempt counter is unavailable" */
    it("still unsubscribes the member", async () => {
      const unsubscribed: { userId: string; sendId: string }[] = [];
      const service = DigestUnsubscribeService.create({
        secret: "secret",
        limits: {
          count: async () => {
            throw new Error("redis is down");
          },
        },
        audience: {
          findUnsubscribed: async () => [],
          unsubscribe: async ({ userId, sendId }) => {
            unsubscribed.push({ userId, sendId });
          },
          resubscribe: async () => {},
        },
        users: { findById: async ({ id }) => ({ id }) as never },
        now: () => Date.now(),
      });
      const token = service.token({ userId: "user-1", sendId: "send-1" });

      await expect(service.unsubscribe({ token, callerAddress: CALLER })).resolves.toBeUndefined();

      expect(unsubscribed).toEqual([{ userId: "user-1", sendId: "send-1" }]);
    });
  });
});
