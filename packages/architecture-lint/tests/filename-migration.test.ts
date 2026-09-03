import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFilenameMigrationMappings, planFilenameMigration } from "../src/filename-migration";

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
  write("packages/features/agent/feature.json", '{"layoutVersion":0}');
  for (const role of ["contract", "server", "web"]) {
    write(
      `packages/features/agent/${role}/package.json`,
      JSON.stringify({ name: `@langwatch/agent-${role}` }),
    );
  }
}

describe("strict filename migration", () => {
  it("plans AST-aware imports and exact manifest/tsconfig path updates", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-migration-"));
    packageFixture();
    write(
      "packages/features/agent/server/src/services/agentService.service.ts",
      "export const service = true;",
    );
    write(
      "packages/features/agent/server/src/repositories/prisma.agent.repository.ts",
      "export const repository = true;",
    );
    write("packages/features/agent/web/src/agentCard.tsx", "export const card = true;");
    write(
      "packages/features/agent/server/src/index.ts",
      'export { service } from "./services/agentService.service";\nexport { service as esmService } from "./services/agentService.service.js";\nexport { repository } from "./repositories/prisma.agent.repository";\n',
    );
    write(
      "packages/features/agent/server/package.json",
      JSON.stringify({
        name: "@langwatch/agent-server",
        exports: { "./service": "./src/services/agentService.service.ts" },
      }),
    );
    write(
      "packages/features/agent/server/tsconfig.json",
      JSON.stringify({ include: ["src/services/agentService.service.ts"] }),
    );
    write(
      "packages/features/agent/adrs/001-layout.md",
      "Move [`packages/features/agent/server/src/services/agentService.service.ts`] in the next migration.\nThe agentService name in prose is not a path.\n",
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
      [
        "packages/features/agent/server/src/services/agentService.service.ts",
        "packages/features/agent/server/src/services/agent-service.service.ts",
      ],
      [
        "packages/features/agent/web/src/agentCard.tsx",
        "packages/features/agent/web/src/agent-card.tsx",
      ],
    ]);
    expect(plan.edits.get(join(root, "packages/features/agent/server/src/index.ts"))).toContain(
      '"./services/agent-service.service"',
    );
    expect(plan.edits.get(join(root, "packages/features/agent/server/src/index.ts"))).toContain(
      '"./services/agent-service.service.js"',
    );
    expect(plan.edits.get(join(root, "packages/features/agent/server/package.json"))).toContain(
      "./src/services/agent-service.service.ts",
    );
    expect(plan.edits.get(join(root, "packages/features/agent/server/tsconfig.json"))).toContain(
      "src/services/agent-service.service.ts",
    );
    expect(plan.edits.get(join(root, "packages/features/agent/adrs/001-layout.md"))).toContain(
      "packages/features/agent/server/src/services/agent-service.service.ts",
    );
    expect(plan.remainingTextualReferences).toEqual([]);
  });

  it("refuses a target collision instead of proposing an overwrite", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-collision-"));
    packageFixture();
    write(
      "packages/features/agent/server/src/services/agentService.service.ts",
      "export const oldValue = true;",
    );
    write(
      "packages/features/agent/server/src/services/agent-service.service.ts",
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
      "packages/features/agent/server/src/adapters/apiKeyToken.apiKeyToken.adapter.ts",
      "export const apiKeyToken = true;",
    );
    write(
      "packages/features/agent/server/src/adapters/gitHub.gitHubHost.adapter.ts",
      "export const github = true;",
    );
    // Canonical already: a dotted technology qualifier is the spelling the
    // layout asks for, so the planner leaves these alone even when the two
    // qualifiers repeat. Collapsing them here would rename files the layout
    // lint accepts, which is why the check that skips them comes first.
    write(
      "packages/features/agent/server/src/adapters/postgres.postgres.adapter.ts",
      "export const postgres = true;",
    );
    write(
      "packages/features/agent/server/src/adapters/anthropic-admin-puller.adapter.ts",
      "export const anthropic = true;",
    );

    const relativeMappings = collectFilenameMigrationMappings(root).map(({ from, to }) => [
      from.slice(root.length + 1),
      to.slice(root.length + 1),
    ]);
    expect(relativeMappings).toEqual([
      [
        "packages/features/agent/server/src/adapters/apiKeyToken.apiKeyToken.adapter.ts",
        "packages/features/agent/server/src/adapters/api-key-token.adapter.ts",
      ],
      [
        "packages/features/agent/server/src/adapters/gitHub.gitHubHost.adapter.ts",
        "packages/features/agent/server/src/adapters/git-hub-host.adapter.ts",
      ],
    ]);
  });

  it("does not rewrite ordinary strings or comments", () => {
    root = mkdtempSync(join("/tmp", "langwatch-filename-strings-"));
    packageFixture();
    write(
      "packages/features/agent/server/src/services/agentService.service.ts",
      "export const service = true;",
    );
    write(
      "packages/features/agent/server/src/notes.ts",
      '// "./services/agentService.service"\nconst value = "agentService.service";\n',
    );

    const plan = planFilenameMigration(root);
    expect(plan.edits.has(join(root, "packages/features/agent/server/src/notes.ts"))).toBe(false);
    expect(
      readFileSync(join(root, "packages/features/agent/server/src/notes.ts"), "utf8"),
    ).toContain("agentService.service");
  });
});
