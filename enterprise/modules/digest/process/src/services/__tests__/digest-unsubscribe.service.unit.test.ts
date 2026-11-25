// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The unsubscribe must always work: a failing attempt counter lets the attempt through.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryDigestAudienceRepository } from "../../repositories/memory/memory.digest-audience.repository.ts";
import { MemoryDigestCallCounterRepository } from "../../repositories/memory/memory.digest-call-counter.repository.ts";
import { DigestUnsubscribeService } from "../digest-unsubscribe.service.ts";

const CALLER = "203.0.113.7";
const AT = new Date("2026-01-01T00:00:00Z");

/** The attempt counter as it answers while its store is down. */
class UnavailableCallCounterRepository extends MemoryDigestCallCounterRepository {
  override count(): Promise<never> {
    return Promise.reject(new Error("redis is down"));
  }
}

function profileOf(id: string): UserProfile {
  return {
    id,
    name: null,
    email: `${id}@example.test`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: AT,
    updatedAt: AT,
    lastLoginAt: null,
    deactivatedAt: null,
  };
}

describe("the digest's unsubscribe service", () => {
  describe("when the attempt counter fails", () => {
    /** @scenario "Unsubscribe still works when the attempt counter is unavailable" */
    it("still unsubscribes the member", async () => {
      const audience = MemoryDigestAudienceRepository.create();
      const service = DigestUnsubscribeService.create({
        secret: "secret",
        limits: new UnavailableCallCounterRepository(),
        audience,
        users: createApiFixture<Pick<UserApi, "findById">>(
          { findById: async ({ id }) => profileOf(id) },
          "UserApi",
        ),
        now: () => Date.now(),
      });
      const token = service.token({ userId: "user-1", sendId: "send-1" });

      await expect(service.unsubscribe({ token, callerAddress: CALLER })).resolves.toBeUndefined();

      expect([...audience.unsubscribeSources()]).toEqual([["user-1", "send-1"]]);
    });
  });
});
