/**
 * @scenario "hono's bodyLimit never comes back"
 *
 * hono's own `bodyLimit` crashes under @hono/node-server for any request
 * without Content-Length — see `wire-body-limit.ts` and its test for the
 * mechanism. Nothing about that middleware looks broken at a call site, so
 * the only durable guard is refusing the import outright: a future route
 * reaching for the obvious name reintroduces a 500 on every chunked sender.
 *
 * Use `wireBodyLimit` from `~/server/api/wire-body-limit` instead.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../../../..");

describe("hono/body-limit imports", () => {
  it("finds no source file importing hono's bodyLimit", () => {
    // `git grep` rather than a directory walk: it honours .gitignore, so
    // build output and node_modules cannot produce a phantom hit.
    let hits = "";
    try {
      hits = execFileSync(
        "git",
        ["grep", "-l", "hono/body-limit", "--", "src", "ee"],
        { cwd: APP_ROOT, encoding: "utf8" },
      );
    } catch (error: unknown) {
      // git grep exits 1 with no output when nothing matches — the passing
      // case. Any other failure is a broken test, not a clean tree.
      const status = (error as { status?: number }).status;
      if (status !== 1) throw error;
    }

    const offenders = hits
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      // This test names the import it bans, so it matches itself.
      .filter((file) => !file.endsWith("no-hono-body-limit.unit.test.ts"));

    expect(offenders).toEqual([]);
  });
});
