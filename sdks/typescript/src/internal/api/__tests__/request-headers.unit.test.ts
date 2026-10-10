import { describe, expect, it } from "vitest";

import { runWithCredentialHolder, setResolvedProjectId } from "../../credentialContext";
import { buildRequestHeaders } from "../request-headers";

const USER_SCOPED_KEY = "sk-lw-abcdef1234567890_secretvalue";

const basicProject = (headers: Record<string, string>): string | undefined => {
  const value = headers.authorization;
  if (!value?.startsWith("Basic ")) return undefined;
  return Buffer.from(value.slice("Basic ".length), "base64").toString("utf-8").split(":")[0];
};

describe("buildRequestHeaders", () => {
  /** @scenario "a command that builds its own request carries the resolved project" */
  describe("when the resolver chose a project and the command names none", () => {
    it("scopes the user-scoped key to that project", () => {
      const headers = runWithCredentialHolder(() => {
        setResolvedProjectId("project_checkout");
        return buildRequestHeaders({ apiKey: USER_SCOPED_KEY });
      });

      expect(basicProject(headers)).toBe("project_checkout");
    });
  });

  describe("when the command names its own project", () => {
    it("keeps the command's project", () => {
      const headers = runWithCredentialHolder(() => {
        setResolvedProjectId("project_checkout");
        return buildRequestHeaders({ apiKey: USER_SCOPED_KEY, projectId: "project_billing" });
      });

      expect(basicProject(headers)).toBe("project_billing");
    });
  });
});
