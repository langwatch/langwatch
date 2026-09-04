/**
 * How the CLI answers a `--project` it cannot resolve, and how it reports the
 * reach of the login key: `projects list` and `whoami`.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 */
import { readCliErrorDocument } from "@langwatch/langy/cards/handled-error";
import { describe, expect, it } from "vitest";
import {
  installCrossProjectHarness,
  LOGIN_KEY,
  ORG_WIDE_SCOPE,
  OTHER_PROJECT,
  PERSONAL_PROJECT,
  PERSONAL_PROJECT_ROW,
} from "./crossProjectAccessHarness";

const { writeSession, run, recorded } = installCrossProjectHarness();

const loginWithOrgWideKey = () =>
  writeSession({
    cli_api_key: LOGIN_KEY,
    cli_api_key_scope: ORG_WIDE_SCOPE,
  });

describe("given a login that minted a user-scoped CLI key", () => {
  describe("when --project names a project the key cannot reach", () => {
    /** @scenario "--project outside the key's reach fails with a clear message" */
    it("exits non-zero and says the login key has no access to it", async () => {
      writeSession({
        cli_api_key: LOGIN_KEY,
        cli_api_key_scope: {
          kind: "projects",
          project_ids: [OTHER_PROJECT.id],
        },
      });

      const result = await run({
        args: ["trace", "get", "abc123", "--project", "someone-elses", "-o", "json"],
      });

      expect(result.exitCode).not.toBe(0);
      const document = readCliErrorDocument(result.stdout);
      expect(document?.code).toBe("project_not_accessible");
      expect(document?.meta?.project).toBe("someone-elses");
      expect(result.stderr).toContain("someone-elses");
      expect(result.stderr).toContain("no access");
      // The request was never made: nothing was read from a project the key
      // cannot reach.
      expect(recorded.traceGetAuth).toBeNull();
    });
  });

  describe("when --project names nothing that exists", () => {
    /** @scenario "--project with an unknown slug fails with a clear message" */
    it("exits non-zero and says no accessible project matches the value", async () => {
      loginWithOrgWideKey();

      const result = await run({
        args: ["trace", "search", "--project", "does-not-exist"],
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        'no accessible project matches "does-not-exist"',
      );
      expect(recorded.searchAuth).toBeNull();
    });
  });

  describe("when the user lists the projects the login reaches", () => {
    /** @scenario "projects list shows every project the key can view" */
    it("lists every project of the organization with its id and slug", async () => {
      loginWithOrgWideKey();

      const result = await run({ args: ["projects", "list"] });

      expect(result.exitCode).toBe(0);
      expect(recorded.projectsAuth).toBe(`Bearer ${LOGIN_KEY}`);
      for (const project of [PERSONAL_PROJECT_ROW, OTHER_PROJECT]) {
        expect(result.stdout).toContain(project.id);
        expect(result.stdout).toContain(project.slug);
      }
    });
  });

  describe("when the user asks who they are", () => {
    /** @scenario "whoami summarises the login key's scope" */
    it("names the organization and states the login key's reach", async () => {
      loginWithOrgWideKey();

      const result = await run({ args: ["whoami"] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Organization: Acme");
      expect(result.stdout).toContain("Login key:    whole organization");
    });

    /** @scenario "whoami states the login key's permissions" */
    it("lists the permission slugs the key was minted with", async () => {
      writeSession({
        cli_api_key: LOGIN_KEY,
        cli_api_key_scope: {
          ...ORG_WIDE_SCOPE,
          permissions: ["scenarios:manage", "prompts:view"],
        },
      });

      const result = await run({ args: ["whoami"] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "Permissions:  prompts:view, scenarios:manage",
      );
    });

    /** @scenario "whoami stays silent about permissions the login never recorded" */
    it("prints no permissions line when the login predates the field", async () => {
      loginWithOrgWideKey();

      const result = await run({ args: ["whoami"] });

      // The exit code first: an absence assertion on stdout also holds when
      // the command failed and printed nothing at all.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("Permissions:");
    });

    it("counts the projects when the key covers a subset", async () => {
      writeSession({
        cli_api_key: LOGIN_KEY,
        cli_api_key_scope: {
          kind: "projects",
          project_ids: [PERSONAL_PROJECT.id, OTHER_PROJECT.id],
        },
      });

      const result = await run({ args: ["whoami"] });

      expect(result.stdout).toContain("Login key:    2 projects");
    });

    it("says nothing about a login key when the server minted none", async () => {
      writeSession();

      const result = await run({ args: ["whoami"] });

      expect(result.stdout).not.toContain("Login key:");
    });
  });
});
