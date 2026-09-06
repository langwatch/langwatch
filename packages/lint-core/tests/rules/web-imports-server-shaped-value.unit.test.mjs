import { afterAll, describe, expect, it } from "vitest";
import { webImportsServerShapedValueRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { auth: { layoutVersion: 0, roles: { web: {}, server: {} } } },
});

afterAll(() => workspace.cleanup());

const WEB_FILE = "packages/features/auth/web/src/behavior/auth-client.ts";
const UI_FILE = "apps/ui/src/behavior/ui-session-client.ts";
const SERVER_FILE = "packages/features/auth/server/src/services/auth.service.ts";

function report(filename, code) {
  return runRule(webImportsServerShapedValueRule, { code, cwd: workspace.cwd, filename });
}

describe("given a browser module", () => {
  describe("when it value-imports a database client", () => {
    /** @scenario "A browser module value-importing a server-shaped package is reported" */
    it("reports serverShaped and names the specifier", () => {
      const found = report(WEB_FILE, 'import { Kysely } from "kysely";');

      expect(found.map((entry) => entry.messageId)).toEqual(["serverShaped"]);
      expect(found[0].message).toContain("kysely");
    });
  });

  describe("when the browser module belongs to the application rather than a feature", () => {
    /** @scenario "The rule covers apps/ui as well as the web feature packages" */
    it("reports it there too", () => {
      const found = report(UI_FILE, 'import { createClient } from "@clickhouse/client";');

      expect(found.map((entry) => entry.messageId)).toEqual(["serverShaped"]);
    });
  });

  describe("when it imports the same package as a type", () => {
    /** @scenario "A type-only import of a server-shaped package is left alone" */
    it("reports nothing, because a type is erased and never loads its graph", () => {
      expect(report(WEB_FILE, 'import type { Kysely } from "kysely";')).toEqual([]);
      expect(report(WEB_FILE, 'import { type Kysely } from "kysely";')).toEqual([]);
    });
  });

  describe("when it imports a better-auth entrypoint meant for the browser", () => {
    /** @scenario "The browser entrypoints better-auth ships stay allowed" */
    it("reports nothing for the client entrypoints the trimmed contract covers", () => {
      expect(report(UI_FILE, 'import { createAuthClient } from "better-auth/react";')).toEqual([]);
      expect(
        report(UI_FILE, 'import { passkeyClient } from "@better-auth/passkey/client";'),
      ).toEqual([]);
    });
  });

  describe("when it imports better-auth's server half", () => {
    /** @scenario "A browser module reaching better-auth's server half is reported" */
    it("reports serverShaped", () => {
      const found = report(WEB_FILE, 'import { betterAuth } from "better-auth";');

      expect(found.map((entry) => entry.messageId)).toEqual(["serverShaped"]);
    });
  });
});

describe("given a server module", () => {
  describe("when it value-imports the same package", () => {
    /** @scenario "Server code may value-import a server-shaped package" */
    it("reports nothing", () => {
      expect(report(SERVER_FILE, 'import { betterAuth } from "better-auth";')).toEqual([]);
    });
  });
});

describe("given a browser test file", () => {
  describe("when it value-imports a server-shaped package", () => {
    /** @scenario "A browser test may value-import a server-shaped package" */
    it("reports nothing, because a test does not ship to a browser", () => {
      expect(
        report(
          "packages/features/auth/web/src/behavior/__tests__/auth-client.unit.test.ts",
          'import { betterAuth } from "better-auth";',
        ),
      ).toEqual([]);
    });
  });
});
