import { afterAll, describe, expect, it } from "vitest";

import { enterpriseLicenseHeaderRule } from "../../src/rules/enterprise-license-header.rule.mjs";
import { signatureMirrorRule } from "../../src/rules/signature-mirror.rule.mjs";
import { standInCastRule } from "../../src/rules/stand-in-cast.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});
const DIRECTIVE = "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise";

afterAll(() => workspace.cleanup());

function run(rule, code, filename) {
  return runRule(rule, { code, cwd: workspace.cwd, filename });
}

describe("given architecture lint runs over a module outside enterprise", () => {
  /** @scenario "Enterprise implementation cannot silently move into core" */
  it("names the directive line and asks for ownership to be restored, not the marker deleted", () => {
    const found = run(
      enterpriseLicenseHeaderRule,
      `${DIRECTIVE}\nexport {};\n`,
      "modules/trace/process/src/trace.service.ts",
    );

    expect(found).toEqual([
      expect.objectContaining({ messageId: "enterpriseLicenseOutsideEnterprise", line: 1 }),
    ]);
    expect(found[0].message).toContain("enterprise/modules/");
    expect(found[0].message).toContain("never delete the directive");
  });

  /** @scenario "An import before the license header cannot conceal ownership" */
  it("still reports the directive when an import precedes it", () => {
    const found = run(
      enterpriseLicenseHeaderRule,
      `import "./dependency.js";\n${DIRECTIVE}\nexport {};\n`,
      "modules/trace/process/src/trace.service.ts",
    );

    expect(found).toEqual([
      expect.objectContaining({ messageId: "enterpriseLicenseOutsideEnterprise", line: 2 }),
    ]);
  });
});

describe("given a boundary type mirrors a signature through a global utility type", () => {
  const code = "export type Mirror = Parameters<typeof create>[0];";

  /** @scenario "Public boundaries state their own named inputs and outputs" */
  it.each([
    "modules/trace/contract/src/trace.commands.ts",
    "modules/trace/process/src/app/trace.app.ts",
    "apps/api/src/trace.composition.ts",
  ])("directs the author at %s to explicit contract input and output types", (filename) => {
    const found = run(signatureMirrorRule, code, filename);

    expect(found).toEqual([expect.objectContaining({ messageId: "mirroredSignature" })]);
    expect(found[0].message).toContain("named contract types");
    expect(found[0].message).toContain("z.infer");
  });

  /** @scenario "Real technical internals remain outside the signature boundary rule" */
  it("does not report a private repository implementation using the utility internally", () => {
    const found = run(
      signatureMirrorRule,
      code,
      "modules/trace/process/src/repositories/prisma/trace.repository.ts",
    );

    expect(found).toEqual([]);
  });
});

describe("given a composition casts a collaborator through unknown", () => {
  /** @scenario "Casting through unknown cannot conceal a broken boundary" */
  it.each(["unknown", "any"])(
    "asks for schema validation or a corrected type through %s",
    (through) => {
      const found = run(
        standInCastRule,
        `const client = raw as ${through} as PrismaClient;`,
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([expect.objectContaining({ messageId: "doubleCast" })]);
      expect(found[0].message).toContain("Zod schema");
      expect(found[0].message).toContain("fix the type of whatever produced it");
    },
  );
});
