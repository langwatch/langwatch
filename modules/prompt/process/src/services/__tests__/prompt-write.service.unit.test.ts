/**
 * `PromptWriteService.assertModifyPermission` refuses a denied change as a
 * handled 403, never a bare 500.
 * @vitest-environment node
 */
import { PromptModifyNotPermittedError } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LlmConfigRepository } from "../../repositories/prompt.repository.ts";
import type { PromptReadService } from "../prompt-read.service.ts";
import type { PromptTagLookupService } from "../prompt-tag-lookup.service.ts";
import type { PromptVersionService } from "../prompt-version.service.ts";
import { PromptWriteService } from "../prompt-write.service.ts";

const REASON = "Only the project that created this organization-level prompt can modify it";

function deniedWrites(): PromptWriteService {
  return PromptWriteService.create({
    repository: createApiFixture<LlmConfigRepository>({
      checkModifyPermission: () => Promise.resolve({ hasPermission: false, reason: REASON }),
    }),
    versionService: createApiFixture<PromptVersionService>(),
    read: createApiFixture<PromptReadService>(),
    tagLookup: createApiFixture<PromptTagLookupService>(),
    toVersionedPrompt: () => {
      throw new Error("not reached");
    },
    modelProviders: createApiFixture(),
  });
}

describe("PromptWriteService.assertModifyPermission", () => {
  describe("when the repository denies the change", () => {
    it("throws insufficient_permissions with a 403 and the repository's reason", async () => {
      const error = await deniedWrites()
        .assertModifyPermission({ idOrHandle: "p", projectId: "project-b", organizationId: "org" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PromptModifyNotPermittedError);
      expect(error).toMatchObject({
        code: "insufficient_permissions",
        httpStatus: 403,
        message: REASON,
      });
    });
  });
});
