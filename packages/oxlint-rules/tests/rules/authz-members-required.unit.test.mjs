import { afterAll, describe, expect, it } from "vitest";

import { authzMembersRequiredRule } from "../../src/rules/authz-members-required.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({ features: {} });

afterAll(() => workspace.cleanup());

const ACCESS = "packages/api/src/access/access.ts";
const DOOR = "packages/api/src/hosting/api-door.ts";

function namesReported(code, filename = ACCESS) {
  return runRule(authzMembersRequiredRule, { code, cwd: workspace.cwd, filename }).map(
    (finding) => [finding.messageId, finding.data.name],
  );
}

describe("given an exported authorization type", () => {
  describe("when a question on it is optional", () => {
    /** @scenario "An optional question on an authorization type is reported" */
    it("reports optionalMember for a method, a `| undefined` function and a nested shape", () => {
      const found = namesReported(
        "export interface Authorize {\n" +
          "  getDecision(input: unknown): Promise<boolean>;\n" +
          "  projectKindOf?(projectId: string): Promise<string | null>;\n" +
          "  organizationOf: ((id: string) => Promise<string>) | undefined;\n" +
          "}\n" +
          "export type Port = Readonly<{ forRequest?: (request: Request) => Authorize }>;",
      );

      expect(found).toEqual([
        ["optionalMember", "Authorize.projectKindOf"],
        ["optionalMember", "Authorize.organizationOf"],
        ["optionalMember", "Port.forRequest"],
      ]);
    });

    /** @scenario "An optional question on an authorization type is reported" */
    it("reports it on the api door too", () => {
      expect(
        namesReported("export type RestIdentity = { authenticateTwice?(): void };", DOOR),
      ).toEqual([["optionalMember", "RestIdentity.authenticateTwice"]]);
    });
  });

  describe("when the optional question is one left optional on purpose", () => {
    /** @scenario "A deliberately optional question is accepted" */
    it("reports nothing", () => {
      expect(
        namesReported(
          "export type RestIdentity = Readonly<{ authorize?(input: unknown): void; authorizePlatform?(): void }>;",
          DOOR,
        ),
      ).toEqual([]);
    });
  });

  describe("when the optional member is data or a parameter field", () => {
    /** @scenario "Optional data and parameter fields are accepted" */
    it("reports nothing", () => {
      expect(
        namesReported(
          "export type Caller = Readonly<{ actor: string | null; scope?: string | null }>;\n" +
            "export interface Authorize {\n" +
            "  assertSecondFactor(input: { sessionId?: string; check?: () => void }): Promise<void>;\n" +
            "}",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a type the rule does not govern", () => {
  /** @scenario "Types outside the authorization ports are accepted" */
  it("reports nothing for an unexported type, a test file or another path", () => {
    const code = "export interface Port { decide?(): boolean }";

    expect(namesReported("interface Port { decide?(): boolean }")).toEqual([]);
    expect(namesReported(code, "packages/api/src/access/__tests__/access.unit.test.ts")).toEqual(
      [],
    );
    expect(namesReported(code, "packages/api/src/rest/runtime.ts")).toEqual([]);
  });
});
