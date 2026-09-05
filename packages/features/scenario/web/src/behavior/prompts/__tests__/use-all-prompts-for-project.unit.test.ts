/**
 * specs/prompts/prompt-list-copy-counts.feature, the transport rule.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import { useAllPromptsForProject } from "../use-all-prompts-for-project";

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(() => ({ data: [] })),
}));

vi.mock("../../scenario-api", () => ({
  api: {
    prompts: {
      getAllPromptsForProject: { useQuery: useQueryMock },
    },
  },
}));

vi.mock("../../use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ projectId: "project-1" }),
}));

describe("useAllPromptsForProject", () => {
  describe("when a screen asks for the prompt catalog", () => {
    /** @scenario "The catalog query travels on its own request" */
    it("sends the request unbatched", () => {
      useAllPromptsForProject();

      expect(useQueryMock).toHaveBeenCalledWith(
        { projectId: "project-1" },
        expect.objectContaining({
          trpc: { context: { skipBatch: true } },
        }),
      );
    });
  });
});
