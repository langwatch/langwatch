/**
 * Where `--project` moves a data command, by id and by slug, and how the
 * selected project reaches the commands that assemble their own request.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 */
import { describe, expect, it } from "vitest";
import {
  installCrossProjectHarness,
  LOGIN_KEY,
  ORG_WIDE_SCOPE,
  OTHER_PROJECT,
} from "./crossProjectAccessHarness";

const { writeSession, run, basicFor, recorded } = installCrossProjectHarness();

const loginWithOrgWideKey = () =>
  writeSession({
    cli_api_key: LOGIN_KEY,
    cli_api_key_scope: ORG_WIDE_SCOPE,
  });

describe("given a login key that reaches the whole organization", () => {
  describe("when --project names another project by id", () => {
    /** @scenario "trace search against another project by id" */
    it("scopes the search to that project", async () => {
      loginWithOrgWideKey();

      const result = await run({
        args: ["trace", "search", "--project", "proj-b", "-o", "json"],
      });

      expect(result.exitCode).toBe(0);
      expect(recorded.searchAuth).toBe(
        basicFor({ projectId: "proj-b", apiKey: LOGIN_KEY }),
      );
    });
  });

  describe("when --project names another project by slug", () => {
    /** @scenario "trace search against another project by slug" */
    it("resolves the slug through the project list and scopes the search to its id", async () => {
      loginWithOrgWideKey();

      const result = await run({
        args: ["trace", "search", "--project", "checkout-agent", "-o", "json"],
      });

      expect(result.exitCode).toBe(0);
      expect(recorded.projectsListCalls).toBe(1);
      expect(recorded.projectsAuth).toBe(`Bearer ${LOGIN_KEY}`);
      expect(recorded.searchAuth).toBe(
        basicFor({ projectId: OTHER_PROJECT.id, apiKey: LOGIN_KEY }),
      );
    });
  });

  describe("when a command calls the platform without the generated client", () => {
    // `trace export` and `session events` assemble their own request, so the
    // project id has to reach them by a second route. A wiring guard rather
    // than a scenario: nothing about the user's story changes per command.
    it("scopes trace export to the selected project", async () => {
      loginWithOrgWideKey();

      const result = await run({
        args: ["trace", "export", "--project", "checkout-agent", "--format", "jsonl"],
      });

      expect(result.exitCode).toBe(0);
      expect(recorded.searchAuth).toBe(
        basicFor({ projectId: OTHER_PROJECT.id, apiKey: LOGIN_KEY }),
      );
    });

    it("scopes session events to the selected project", async () => {
      loginWithOrgWideKey();

      const result = await run({
        args: ["session", "events", "sess_1", "--project", "proj-b", "-o", "json"],
      });

      expect(result.exitCode).toBe(0);
      expect(recorded.sessionEventsAuth).toBe(
        basicFor({ projectId: OTHER_PROJECT.id, apiKey: LOGIN_KEY }),
      );
    });
  });
});
