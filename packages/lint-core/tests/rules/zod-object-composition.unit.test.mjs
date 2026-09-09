import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { zodObjectCompositionRule } from "../../src/rules/zod-object-composition.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const filename = "packages/features/project/contract/src/example.contract.ts";
const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { contract: {} } } },
  files: {
    "packages/shared-schema/package.json":
      '{"name":"@langwatch/shared-schema","exports":{".":"./src/base.ts"}}',
    "packages/shared-schema/src/base.ts":
      'import { z } from "zod"; export const base = z.object({ id: z.string() });',
    "packages/features/project/contract/src/base.ts":
      'import { z } from "zod"; export const base = z.object({ id: z.string() });',
    "packages/features/project/contract/src/barrel.ts":
      'export { base as schema } from "./base.ts";',
    "packages/features/project/contract/src/star.ts": 'export * from "./barrel.ts";',
    "packages/features/project/contract/src/refined.ts":
      'import { z } from "zod"; export const base = z.object({ id: z.string() }).refine(value => value.id.length > 0);',
    "packages/features/project/contract/src/other.ts":
      "export const base = { extend(value) { return value; } };",
    "packages/features/project/contract/src/cycle-a.ts": 'export * from "./cycle-b.ts";',
    "packages/features/project/contract/src/cycle-b.ts": 'export * from "./cycle-a.ts";',
  },
});
mkdirSync(join(workspace.cwd, "node_modules/@langwatch"), { recursive: true });
symlinkSync(
  join(workspace.cwd, "packages/shared-schema"),
  join(workspace.cwd, "node_modules/@langwatch/shared-schema"),
  "dir",
);
afterAll(() => workspace.cleanup());

function report(code, path = filename) {
  return runRule(zodObjectCompositionRule, { code, cwd: workspace.cwd, filename: path });
}

describe("efficient Zod object composition", () => {
  it.each([
    [
      "named import",
      'import { z } from "zod"; const base = z.object({}); base.extend({ id: z.string() });',
    ],
    ["namespace import", 'import * as schema from "zod"; schema.object({}).extend({});'],
    ["default import", 'import schema from "zod"; schema.object({}).extend({});'],
    [
      "constructor alias",
      'import { object as make } from "zod"; const base = make({}); base.extend({});',
    ],
    [
      "local alias",
      'import { z } from "zod"; const base = z.object({}); const alias = base; alias.merge(z.object({}));',
    ],
    ["computed member", 'import { z } from "zod"; z.object({})["extend"]({});'],
    [
      "shape selection",
      'import { z } from "zod"; z.object({id: z.string()}).omit({id: true}).extend({});',
    ],
    ["strict object", 'import { z } from "zod"; z.strictObject({}).extend({});'],
    ["catchall", 'import { z } from "zod"; z.object({}).catchall(z.string()).extend({});'],
    ["relative import alias", 'import { base as renamed } from "./base.ts"; renamed.extend({});'],
    [
      "workspace package export",
      'import { base } from "@langwatch/shared-schema"; base.extend({});',
    ],
    ["re-export", 'import { schema } from "./star.ts"; schema.extend({});'],
    ["namespace of schemas", 'import * as schemas from "./base.ts"; schemas.base.extend({});'],
  ])("reports %s composition without offering an unsafe automatic fix", (_name, code) => {
    const findings = report(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].messageId).toBe("spreadShape");
    expect(findings[0].message).toContain("preserve strictness and catchalls");
    expect(zodObjectCompositionRule.meta.fixable).toBeUndefined();
  });

  it.each([
    'import { z } from "zod"; z.object({}).refine(() => true).extend({});',
    'import { base } from "./refined.ts"; base.extend({});',
  ])("directs refined objects to safeExtend", (code) => {
    const findings = report(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].messageId).toBe("keepRefinements");
    expect(findings[0].message).toContain("Use .safeExtend()");
  });

  it.each([
    [
      "spread",
      'import { z } from "zod"; const base = z.object({}); z.object({ ...base.shape, id: z.string() });',
    ],
    [
      "refinements retained",
      'import { z } from "zod"; z.object({}).refine(() => true).safeExtend({});',
    ],
    ["unrelated API", "const base = { extend(x) { return x; } }; base.extend({});"],
    ["unrelated imported API", 'import { base } from "./other.ts"; base.extend({});'],
    [
      "shadowed Zod import",
      'import { z } from "zod"; function run(z) { return z.object({}).extend({}); }',
    ],
    [
      "shadowed schema",
      'import { z } from "zod"; const base = z.object({}); function run(base) { return base.extend({}); }',
    ],
    ["opaque factory", 'import { factory } from "elsewhere"; factory().extend({});'],
    ["cyclic re-export", 'import { base } from "./cycle-a.ts"; base.extend({});'],
  ])("leaves %s alone", (_name, code) => {
    expect(report(code)).toEqual([]);
  });

  it("does not let an unrelated shadow hide an outer schema", () => {
    const findings = report(
      'import { z } from "zod"; const base = z.object({}); function run(base) { base.extend({}); } base.extend({});',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].messageId).toBe("spreadShape");
  });

  it("refreshes imported schema provenance when a source file changes", () => {
    const path = "packages/features/project/contract/src/changing.ts";
    workspace.write(path, "export const base = { extend(value) { return value; } };");
    const code = 'import { base } from "./changing.ts"; base.extend({});';
    expect(report(code)).toEqual([]);
    workspace.write(path, 'import { z } from "zod"; export const base = z.object({});');
    expect(report(code).map((finding) => finding.messageId)).toEqual(["spreadShape"]);
  });

  it.each(["example.generated.ts", "__tests__/example.unit.test.ts"])("ignores %s", (name) => {
    expect(
      report(
        'import { z } from "zod"; z.object({}).extend({});',
        `packages/features/project/contract/src/${name}`,
      ),
    ).toEqual([]);
  });
});
