/**
 * @vitest-environment node
 * @see specs/worker/worker-capability-mount.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryModelProviderRateLimitRepository } from "../../../../repositories/memory/memory.model-provider-rate-limit.repository.ts";
import { WindowedModelProviderConnectionRateLimiterService } from "../windowed-model-provider-connection-rate-limiter.service.ts";

const ORGANIZATION_CEILING = 20;

describe("the connection-test limiter over a process with no Redis", () => {
  describe("when one organization tests past its ceiling", () => {
    /** @scenario "A worker with no Redis counts its connection windows in process memory" */
    it("counts in this process's memory and refuses with the seconds until the window reopens", async () => {
      const limiter = WindowedModelProviderConnectionRateLimiterService.create({
        limiter: MemoryModelProviderRateLimitRepository.create(),
      });

      for (let attempt = 0; attempt < ORGANIZATION_CEILING; attempt += 1) {
        await limiter.assertAvailable({ organizationId: "org_1" });
      }
      const refusal = await limiter.assertAvailable({ organizationId: "org_1" }).then(
        () => void 0,
        (error: unknown) => error,
      );

      expect(refusal).toMatchObject({
        code: "model_provider_test_rate_limited",
        meta: { retryAfterSeconds: expect.any(Number) },
      });
      await expect(limiter.assertAvailable({ organizationId: "org_2" })).resolves.toBeUndefined();
    });
  });
});
