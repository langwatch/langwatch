/**
 * Which credential a data command authenticates with after `langwatch login`,
 * and which project that credential names when no flag says otherwise.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 */
import { describe, expect, it } from "vitest";
import {
  installCrossProjectHarness,
  LOGIN_KEY,
  ORG_WIDE_SCOPE,
  PERSONAL_KEY,
  PERSONAL_PROJECT,
} from "./crossProjectAccessHarness";

const { writeSession, run, basicFor, recorded } = installCrossProjectHarness();

describe("given a login that minted a user-scoped CLI key", () => {
  describe("when a data command runs with no other credential", () => {
    /** @scenario "data commands authenticate with the user-scoped key" */
    it("authenticates with the stored login key against the personal project", async () => {
      writeSession({
        cli_api_key: LOGIN_KEY,
        cli_api_key_scope: ORG_WIDE_SCOPE,
      });

      const result = await run({ args: ["trace", "search", "-o", "json"] });

      expect(result.exitCode).toBe(0);
      expect(recorded.searchAuth).toBe(
        basicFor({ projectId: PERSONAL_PROJECT.id, apiKey: LOGIN_KEY }),
      );
      // The default target did not move: no listing was needed to find it.
      expect(recorded.projectsListCalls).toBe(0);
    });
  });

  describe("when LANGWATCH_API_KEY is set in the environment", () => {
    /** @scenario "explicit credentials still win over the session key" */
    it("authenticates with the environment key and leaves the login key unused", async () => {
      writeSession({
        cli_api_key: LOGIN_KEY,
        cli_api_key_scope: ORG_WIDE_SCOPE,
      });

      const result = await run({
        args: ["trace", "search", "-o", "json"],
        env: { LANGWATCH_API_KEY: "sk-lw-envprojectkey" },
      });

      expect(result.exitCode).toBe(0);
      expect(recorded.searchAuth).toBe("Bearer sk-lw-envprojectkey");
      expect(recorded.searchAuth).not.toContain(LOGIN_KEY);
    });
  });
});

describe("given a server that mints no user-scoped CLI key", () => {
  describe("when a data command runs", () => {
    /** @scenario "a server without user-scoped keys falls back to the old behavior" */
    it("authenticates with the personal project's own key, exactly as before", async () => {
      writeSession(); // no cli_api_key: a pre-feature login

      const result = await run({ args: ["trace", "search", "-o", "json"] });

      expect(result.exitCode).toBe(0);
      expect(recorded.searchAuth).toBe(`Bearer ${PERSONAL_KEY}`);
    });
  });
});
