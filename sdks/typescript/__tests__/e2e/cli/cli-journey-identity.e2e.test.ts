// @vitest-environment node

/**
 * CLI journey — what the CLI does with the credential it is given, and what it
 * says when it has none.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cliRunnerIn, cliWorkspace, parseJson, type CliWorkspace } from "./helpers";

const CLI_TIMEOUT_MS = 90_000;

describe("given the built CLI and a key in its environment", () => {
  let workspace: CliWorkspace | undefined;

  afterEach(() => {
    workspace?.remove();
    workspace = undefined;
  });

  describe("when a read command runs with only the two environment variables", () => {
    // @scenario "A key in the environment is all a read command needs"
    it("exits zero and prints the project's datasets", () => {
      workspace = cliWorkspace();

      const result = workspace.cli.run("dataset list -o json");

      expect(result.exitCode ?? 0).toBe(0);
      const listed = parseJson<{ data: unknown[] }>(result.output, "dataset list");
      expect(Array.isArray(listed.data)).toBe(true);
    }, CLI_TIMEOUT_MS);
  });

  describe("when I ask who I am with no device session", () => {
    // @scenario "Without a device session the CLI says I am not signed in"
    it("exits non-zero and tells me how to sign in", () => {
      workspace = cliWorkspace();

      const result = workspace.cli.run("whoami");

      expect(result.success).toBe(false);
      expect(result.output).toMatch(/not logged in/i);
      expect(result.output).toMatch(/langwatch login/i);
    }, CLI_TIMEOUT_MS);
  });

  describe("when the environment carries no LangWatch API key", () => {
    // @scenario "A command with no credential says so instead of asking for one"
    it("exits non-zero and names the missing credential", () => {
      workspace = cliWorkspace({ LANGWATCH_API_KEY: undefined });

      const result = workspace.cli.run("dataset list -o json");

      expect(result.success).toBe(false);
      expect(result.output).toContain("missing_api_key");
    }, CLI_TIMEOUT_MS);
  });

  describe("when the endpoint answers nothing", () => {
    // @scenario "A command against an endpoint nothing serves fails by name"
    it("exits non-zero rather than hanging", () => {
      workspace = cliWorkspace({ LANGWATCH_ENDPOINT: "http://127.0.0.1:1" });

      const result = workspace.cli.run("dataset list -o json");

      expect(result.success).toBe(false);
      expect(result.output.length).toBeGreaterThan(0);
    }, CLI_TIMEOUT_MS);
  });

  describe("when I log in with an API key in an empty directory", () => {
    // @scenario "Logging in with an API key writes it to the working directory"
    it("saves the key there and later commands need no key in their environment", () => {
      const key = process.env.LANGWATCH_API_KEY;
      if (!key) throw new Error("LANGWATCH_API_KEY is unset; the global setup should have set it");
      workspace = cliWorkspace();

      const login = workspace.cli.run(`login --api-key ${key}`);
      expect(login.exitCode ?? 0).toBe(0);
      expect(login.output).toMatch(/API key saved successfully/i);

      const envFile = join(workspace.dir, ".env");
      expect(existsSync(envFile)).toBe(true);
      expect(readFileSync(envFile, "utf8")).toContain("LANGWATCH_API_KEY=");

      const withoutKey = cliRunnerIn(workspace.dir, { LANGWATCH_API_KEY: undefined });
      const afterLogin = withoutKey.run("dataset list -o json");
      expect(afterLogin.exitCode ?? 0).toBe(0);

      const listed = parseJson<{ data: unknown[] }>(afterLogin.output, "dataset list");
      expect(Array.isArray(listed.data)).toBe(true);
    }, CLI_TIMEOUT_MS);
  });
});
