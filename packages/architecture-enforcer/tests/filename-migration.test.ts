import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectFilenameMigrationMappings,
  planFilenameMigration,
} from "../src/tools/filename-migration.ts";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function packageFixture(): void {
  for (const role of ["contract", "process", "browser"]) {
    write(
      `modules/agent/${role}/package.json`,
      JSON.stringify({ name: `@langwatch/agent-${role}` }),
    );
  }
}

describe("strict filename migration", () => {
  it("plans AST-aware imports and exact manifest/tsconfig path updates", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-migration-"));
    packageFixture();
    write(
      "modules/agent/process/src/services/agentService.service.ts",
      "export const service = true;",
    );
    write(
      "modules/agent/process/src/repositories/prisma.agent.repository.ts",
      "export const repository = true;",
    );
    write("modules/agent/browser/src/agentCard.tsx", "export const card = true;");
    write(
      "modules/agent/process/src/index.ts",
      'export { service } from "./services/agentService.service";\nexport { service as esmService } from "./services/agentService.service.js";\nexport { repository } from "./repositories/prisma.agent.repository";\n',
    );
    write(
      "modules/agent/process/package.json",
      JSON.stringify({
        name: "@langwatch/agent-process",
        exports: { "./service": "./src/services/agentService.service.ts" },
      }),
    );
    write(
      "modules/agent/process/tsconfig.json",
      JSON.stringify({ include: ["src/services/agentService.service.ts"] }),
    );
    write(
      "modules/agent/adrs/001-layout.md",
      "Move [`modules/agent/process/src/services/agentService.service.ts`] in the next migration.\nThe agentService name in prose is not a path.\n",
    );

    const plan = planFilenameMigration(root);
    expect(plan.collisions).toEqual([]);
    expect(plan.unresolved).toEqual([]);
    expect(
      plan.mappings.map(({ from, to }) => [from.slice(root.length + 1), to.slice(root.length + 1)]),
    ).toEqual([
      // `prisma.agent.repository.ts` is NOT in this list: the dotted
      // technology qualifier is the canonical spelling, so the planner leaves
      // it alone rather than flattening it to a dash.
      ["modules/agent/browser/src/agentCard.tsx", "modules/agent/browser/src/agent-card.tsx"],
      [
        "modules/agent/process/src/services/agentService.service.ts",
        "modules/agent/process/src/services/agent-service.service.ts",
      ],
    ]);
    expect(plan.edits.get(join(root, "modules/agent/process/src/index.ts"))).toContain(
      '"./services/agent-service.service"',
    );
    expect(plan.edits.get(join(root, "modules/agent/process/src/index.ts"))).toContain(
      '"./services/agent-service.service.js"',
    );
    expect(plan.edits.get(join(root, "modules/agent/process/package.json"))).toContain(
      "./src/services/agent-service.service.ts",
    );
    expect(plan.edits.get(join(root, "modules/agent/process/tsconfig.json"))).toContain(
      "src/services/agent-service.service.ts",
    );
    expect(plan.edits.get(join(root, "modules/agent/adrs/001-layout.md"))).toContain(
      "modules/agent/process/src/services/agent-service.service.ts",
    );
    expect(plan.remainingTextualReferences).toEqual([]);
  });

  it("refuses a target collision instead of proposing an overwrite", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-collision-"));
    packageFixture();
    write(
      "modules/agent/process/src/services/agentService.service.ts",
      "export const oldValue = true;",
    );
    write(
      "modules/agent/process/src/services/agent-service.service.ts",
      "export const existingValue = true;",
    );

    const plan = planFilenameMigration(root);
    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]).toContain("target exists");
  });

  it("collapses a repeated qualifier only where the name is not already canonical", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-qualifiers-"));
    packageFixture();
    // Not canonical — the qualifiers are camel case — so both the kebab
    // rewrite and the collapse apply.
    write(
      "modules/agent/process/src/adapters/apiKeyToken.apiKeyToken.adapter.ts",
      "export const apiKeyToken = true;",
    );
    write(
      "modules/agent/process/src/adapters/gitHub.gitHubHost.adapter.ts",
      "export const github = true;",
    );
    // Canonical already: a dotted technology qualifier is the spelling the
    // layout asks for, so the planner leaves these alone even when the two
    // qualifiers repeat. Collapsing them here would rename files the layout
    // lint accepts, which is why the check that skips them comes first.
    write(
      "modules/agent/process/src/adapters/postgres.postgres.adapter.ts",
      "export const postgres = true;",
    );
    write(
      "modules/agent/process/src/adapters/anthropic-admin-puller.adapter.ts",
      "export const anthropic = true;",
    );

    const relativeMappings = collectFilenameMigrationMappings(root).map(({ from, to }) => [
      from.slice(root.length + 1),
      to.slice(root.length + 1),
    ]);
    expect(relativeMappings).toEqual([
      [
        "modules/agent/process/src/adapters/apiKeyToken.apiKeyToken.adapter.ts",
        "modules/agent/process/src/adapters/api-key-token.adapter.ts",
      ],
      [
        "modules/agent/process/src/adapters/gitHub.gitHubHost.adapter.ts",
        "modules/agent/process/src/adapters/git-hub-host.adapter.ts",
      ],
    ]);
  });

  it("does not rewrite ordinary strings or comments", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-strings-"));
    packageFixture();
    write(
      "modules/agent/process/src/services/agentService.service.ts",
      "export const service = true;",
    );
    write(
      "modules/agent/process/src/notes.ts",
      '// "./services/agentService.service"\nconst value = "agentService.service";\n',
    );

    const plan = planFilenameMigration(root);
    expect(plan.edits.has(join(root, "modules/agent/process/src/notes.ts"))).toBe(false);
    expect(readFileSync(join(root, "modules/agent/process/src/notes.ts"), "utf8")).toContain(
      "agentService.service",
    );
  });
});
