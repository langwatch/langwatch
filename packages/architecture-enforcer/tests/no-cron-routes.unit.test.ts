/** Spec: specs/no-cron-routes.feature. Record: dev/docs/ARCHITECTURE.md §9, no cron routes. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "on", "route"]);

/** A cron route sits under `/api/cron`, or `/cron` on a router mounted at `/api`. */
function isCronPath(path: string): boolean {
  return /^(\/api)?\/cron(\/|$)/.test(path);
}

/** The literal first argument of a route method call such as `.post("/api/x")`. */
function routePathOf(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ROUTE_METHODS.has(node.expression.name.text)) return undefined;
  const [first] = node.arguments;
  return first && ts.isStringLiteralLike(first) ? first.text : undefined;
}

/** The cron paths a source declares as the first argument of a route method call. */
function cronRoutesIn({ fileName, text }: { fileName: string; text: string }): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const path = routePathOf(node);
    if (path !== undefined && isCronPath(path)) found.push(path);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const trackedSources = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.mts"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(
      (path) =>
        path !== "" &&
        !path.includes("/__tests__/") &&
        !/\.test\.tsx?$/.test(path) &&
        !path.includes("/generated/"),
    );

describe("cron routes", () => {
  /** @scenario "A route declared under /api/cron is refused" */
  it("names a route declared under /api/cron", () => {
    const text = `
      defineRestRouter(Api).post("/api/cron/old_lambdas_cleanup", "run").build();
      new Hono().basePath("/api").get("/cron/triggers", handler);
    `;

    expect(cronRoutesIn({ fileName: "cron.rest.ts", text })).toEqual([
      "/api/cron/old_lambdas_cleanup",
      "/cron/triggers",
    ]);
  });

  /** @scenario "A comment or a string that is not a route path is not a route" */
  it("ignores a comment or a string that is not a route path", () => {
    const text = `
      /** Replaces main's \`/api/cron/seed_demo\`. */
      const retired = ["/api/cron/seed_demo"];
      router.get("/api/crontab-docs", handler);
    `;

    expect(cronRoutesIn({ fileName: "pipeline.ts", text })).toEqual([]);
  });

  /** @scenario "No tracked source declares a cron route" */
  it("finds no cron route in any tracked source", () => {
    const offenders = trackedSources().flatMap((fileName) => {
      let text: string;
      try {
        text = readFileSync(join(REPO_ROOT, fileName), "utf8");
      } catch {
        return [];
      }
      if (!text.includes("cron")) return [];
      return cronRoutesIn({ fileName, text }).map((path) => `${fileName}: ${path}`);
    });

    expect(offenders).toEqual([]);
  }, 120_000);
});
