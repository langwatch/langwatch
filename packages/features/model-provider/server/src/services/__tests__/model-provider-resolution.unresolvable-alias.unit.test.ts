/**
 * ("Exhaustion caused by an unresolvable latest-alias still reports 'nothing
 * configured'")
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { describe, expect, it, vi } from "vitest";

const UNRESOLVABLE_ALIAS = "openai/latest";

vi.mock("@langwatch/model-provider-contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/model-provider-contract")>()),
  isLatestAlias: (model: string) => model === UNRESOLVABLE_ALIAS,
  // Mirrors the real contract: expandLatestAlias returns the input
  // unchanged when there's nothing to resolve it to.
  expandLatestAlias: (model: string) => model,
}));

import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { ModelProviderResolutionService } from "../model-provider-resolution.service";

const PLAYGROUND = "prompt.create_default";

function resolver() {
  return ModelProviderResolutionService.create({
    defaults: {
      listForOrganization: async () => [
        {
          id: "config-proj-1",
          config: { DEFAULT: UNRESOLVABLE_ALIAS },
          scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
          authorId: null,
          createdAt: new Date("2026-05-15T00:00:00.000Z"),
        },
      ],
      listForProject: async () => [],
    },
    catalog: {
      defaultFeatures: () => [
        {
          key: PLAYGROUND,
          role: "DEFAULT",
          displayName: PLAYGROUND,
          description: "the playground",
        },
      ],
    },
    scopes: {
      getProjectContext: async () => ({ teamId: "team-1", organizationId: "organization-1" }),
      getProjectScopes: async () => [],
    },
  } as never);
}

describe("ModelProviderResolutionService.resolve — unresolvable latest-alias exhaustion", () => {
  /** @scenario 'Exhaustion caused by an unresolvable latest-alias still reports "nothing configured"' */
  it("throws plain ModelNotConfiguredError, not a restriction error", async () => {
    await expect(
      resolver().resolve({ projectId: "project-1", featureKey: PLAYGROUND }),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });
});
