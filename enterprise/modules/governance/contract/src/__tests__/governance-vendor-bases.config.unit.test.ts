import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { governanceConfig } from "../governance.config.ts";

const leaves = [
  ["OPENAI_ADMIN_API_BASE", "openAiAdminApiBase"],
  ["ANTHROPIC_ADMIN_API_BASE", "anthropicAdminApiBase"],
  ["MICROSOFT_LOGIN_BASE", "microsoftLoginBase"],
  ["MICROSOFT_GRAPH_API_BASE", "microsoftGraphApiBase"],
  ["DATABRICKS_WORKSPACE_BASE", "databricksWorkspaceBase"],
  ["DATAVERSE_ENVIRONMENT_BASE", "dataverseEnvironmentBase"],
] as const;

function parse(environment: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "governance", config: governanceConfig }],
    environment,
  }).governance;
}

describe("governance vendor base configuration", () => {
  for (const [variable, leaf] of leaves) {
    describe(`given ${variable}`, () => {
      /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
      it("reads as unset when it is not exported", () => {
        expect(parse({})[leaf]).toBeUndefined();
      });

      /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
      it("reads as unset when it is exported blank", () => {
        expect(parse({ [variable]: "  " })[leaf]).toBeUndefined();
      });

      /** @scenario "A pulled vendor is reached at the base the deployment configures" */
      it("carries the configured URL", () => {
        expect(parse({ [variable]: "http://localhost:6970/x" })[leaf]).toBe(
          "http://localhost:6970/x",
        );
      });

      it("refuses a value that is set but is not a URL", () => {
        expect(() => parse({ [variable]: "not a url" })).toThrow(new RegExp(variable));
      });
    });
  }
});
