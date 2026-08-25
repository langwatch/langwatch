import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintWorkspace } from "../src";

function fixture(contract: string): string {
  const root = mkdtempSync(join(tmpdir(), "service-results-"));
  const write = (path: string, content: string): void => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write(
    "packages/features/catalogue.json",
    JSON.stringify({
      version: 0,
      features: [
        {
          id: "project",
          root: "packages/features/project",
          classification: "core",
          subjects: ["project"],
        },
      ],
    }),
  );
  write("packages/features/project/feature.json", '{"layoutVersion":0}');
  write(
    "packages/features/project/contract/package.json",
    JSON.stringify({
      name: "@fixture/project-contract",
      private: true,
      exports: { ".": "./src/index.ts" },
    }),
  );
  write("packages/features/project/contract/src/index.ts", "export {};\n");
  write("packages/features/project/contract/src/project.service.ts", contract);
  write(
    "packages/features/project/server/package.json",
    JSON.stringify({
      name: "@fixture/project-server",
      private: true,
      exports: { ".": "./src/index.ts" },
    }),
  );
  write("packages/features/project/server/src/index.ts", "export {};\n");
  write(
    "packages/features/project/server/src/services/project.service.ts",
    "export class ProjectService { getById(): string { return 'project'; } }",
  );
  return root;
}

function resultPolicies(root: string) {
  return lintWorkspace({ root, declarations: false }).filter(
    (item) => item.policy === "fallible-result-naming",
  );
}

describe("service result contract lint", () => {
  it("rejects ordinary methods that expose nullable absence", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract findById(): Promise<string | null>; }",
    );
    expect(resultPolicies(root)).toHaveLength(1);
  });

  it("accepts optional try methods", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract tryGetById(): Promise<string | null>; }",
    );
    expect(resultPolicies(root)).toEqual([]);
  });

  it("accepts ordinary methods that return or throw", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract getById(): Promise<string>; }",
    );
    expect(resultPolicies(root)).toEqual([]);
  });

  it("rejects redundant require naming", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract requireById(): Promise<string>; }",
    );
    expect(resultPolicies(root)).toHaveLength(1);
  });

  it("rejects inferred results and still catches inferred require helpers", () => {
    const root = fixture(
      "export class ProjectService { requireById() { return 'project'; } tryGetById() { return null; } }",
    );
    const messages = resultPolicies(root).map((violation) => violation.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"requireById" uses the redundant require prefix'),
        expect.stringContaining('"requireById" has no explicit result type'),
        expect.stringContaining('"tryGetById" has no explicit result type'),
      ]),
    );
  });

  it("rejects try methods that cannot express absence", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract tryGetById(): Promise<string>; }",
    );
    expect(resultPolicies(root)).toHaveLength(1);
  });

  it("applies the same convention to private repository ports", () => {
    const root = fixture(
      "export abstract class ProjectService { abstract getById(): Promise<string>; }",
    );
    const target = join(
      root,
      "packages/features/project/server/src/ports/project.port.ts",
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      "export abstract class ProjectRepository { abstract findById(): Promise<string | null>; }",
    );
    expect(resultPolicies(root)).toHaveLength(1);
  });

  it("does not treat private implementation helpers as service boundaries", () => {
    const root = fixture(
      "export class ProjectService { getById(): Promise<string> { return Promise.resolve('project'); } private map(row: string | null): string | null { return row; } }",
    );
    expect(resultPolicies(root)).toEqual([]);
  });
});
