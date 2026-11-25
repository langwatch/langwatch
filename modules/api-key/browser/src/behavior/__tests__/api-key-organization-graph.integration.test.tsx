/**
 * @vitest-environment jsdom
 *
 * The organization graph the CLI auth page hands its first-trace watch.
 * Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiHostServices: () => ({ session: { currentUser: () => ({ id: "user-1" }) } }),
}));

vi.mock("../api-key-api.ts", () => ({
  apiKeyApi: {
    organization: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "org-1",
              name: "ACME",
              teams: [
                {
                  id: "team-personal",
                  name: "Jane's Workspace",
                  isPersonal: true,
                  ownerUserId: "user-1",
                  projects: [{ id: "proj-personal", name: "Personal", slug: "jane-personal" }],
                },
              ],
            },
          ],
        }),
      },
    },
  },
}));

import { findPersonalProject } from "../../model/personal-project.ts";
import { useApiKeyOrganizationGraph } from "../api-key-organization-graph.ts";

describe("given a user who owns a personal workspace", () => {
  describe("when the page reads the organizations the user belongs to", () => {
    /** @scenario "The page's organization list names who owns each personal workspace" */
    it("keeps the owner on the workspace's team, so the watch finds the personal project", () => {
      const { result } = renderHook(() =>
        useApiKeyOrganizationGraph({ organizationId: "org-1", projectId: void 0 }),
      );

      expect(result.current.hostOrganizations?.[0]?.teams?.[0]?.ownerUserId).toBe("user-1");
      expect(
        findPersonalProject({
          organizations: result.current.hostOrganizations,
          userId: "user-1",
          organizationId: "org-1",
        }),
      ).toEqual({ id: "proj-personal", slug: "jane-personal" });
    });
  });
});
