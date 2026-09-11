import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineRule } from "../define-rule.mjs";

const AS_PRISMA_CLIENT = /\bas\s+PrismaClient\b/;
// `database: object` when it sits directly in a `create(` argument list.
// Narrow on purpose: `object` is a load-bearing type in TypeScript, and only
// its use as the seam for a Prisma client is forbidden.
const DATABASE_OBJECT_ARG =
  /\.create\s*\([^)]*\bdatabase\s*:\s*object\b|\bstatic\s+create\s*\([^)]*\bdatabase\s*:\s*object\b/;

const SEAM_PATH =
  /^(?:enterprise\/)?modules\/[^/]+\/server\/src\/(?:repositories\/prisma\/.+\.repository\.ts|adapters\/postgres\.[^/]+\.adapter\.ts)$/;

const typedPrismaSeamBaselineCache = new Map();

function typedPrismaSeamBaseline(cwd) {
  if (typedPrismaSeamBaselineCache.has(cwd)) return typedPrismaSeamBaselineCache.get(cwd);
  const file = join(cwd, "packages", "architecture-enforcer", "src", "typed-prisma-seam-baseline.json");
  let files = new Set();
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version === 0 && Array.isArray(value.files)) files = new Set(value.files);
    } catch {
      files = new Set();
    }
  }
  typedPrismaSeamBaselineCache.set(cwd, files);
  return files;
}

export const typedPrismaSeamRule = defineRule({
  name: "typed-prisma-seam",
  kind: "problem",
  messages: {
    cast: {
      what: "`as PrismaClient` is not permitted.",
      fix: "The composition adapter takes a typed PrismaClient and hands it to the repository.",
    },
    databaseObject: {
      what: "`database: object` in a `.create(` argument list forces a cast at the seam.",
      fix: "Type the parameter as PrismaClient and take it from the composition root.",
    },
  },
  create(context, file) {
    if (!SEAM_PATH.test(file.workspacePath)) return {};
    if (typedPrismaSeamBaseline(context.cwd).has(file.workspacePath)) return {};

    return {
      Program() {
        const source = context.sourceCode.text;
        for (const [pattern, messageId] of [
          [AS_PRISMA_CLIENT, "cast"],
          [DATABASE_OBJECT_ARG, "databaseObject"],
        ]) {
          const match = pattern.exec(source);
          if (!match) continue;
          context.report({
            loc: { line: source.slice(0, match.index).split(/\r?\n/).length, column: 0 },
            messageId,
          });
        }
      },
    };
  },
});
