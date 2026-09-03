import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectGlobalAppAccesses,
  formatGlobalAppAccessBaseline,
  lintGlobalAppAccess,
} from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-global-app-access-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function baseline(accesses = collectGlobalAppAccesses(root)): void {
  write(
    "packages/architecture-lint/src/global-app-access-baseline.json",
    formatGlobalAppAccessBaseline(accesses),
  );
}

const usageFile = "packages/example/src/usage.ts";

describe("global app access lint", () => {
  it("finds direct, aliased, namespace, dynamic, and require accessor bindings", () => {
    write(
      usageFile,
      [
        'import { getApp as app, tryGetApp } from "~/server/app-layer/app";',
        'import * as legacy from "~/server/app-layer/app";',
        "const direct = tryGetApp();",
        "const first = app();",
        "const second = legacy.tryGetApp();",
        'const third = (await import("~/server/app-layer/app"))["getApp"]();',
        'const { tryGetApp: required } = require("~/server/app-layer/app"); required();',
        "const { getApp: namespaced } = legacy; namespaced();",
        "// getApp() and tryGetApp() are not executable references.",
      ].join("\n"),
    );
    write("packages/example/src/usage.test.ts", 'import { getApp } from "./app"; getApp();');

    const accesses = collectGlobalAppAccesses(root);
    expect(accesses.map(({ symbol, kind }) => ({ symbol, kind }))).toEqual([
      { symbol: "getApp", kind: "import" },
      { symbol: "tryGetApp", kind: "import" },
      { symbol: "tryGetApp", kind: "reference" },
      { symbol: "getApp", kind: "reference" },
      { symbol: "tryGetApp", kind: "reference" },
      { symbol: "getApp", kind: "reference" },
      { symbol: "tryGetApp", kind: "import" },
      { symbol: "tryGetApp", kind: "reference" },
      { symbol: "getApp", kind: "import" },
      { symbol: "getApp", kind: "reference" },
    ]);
    expect(lintGlobalAppAccess(root)).toHaveLength(10);
  });

  it("allows the legacy accessor definition but blocks growth beyond the checked baseline", () => {
    write(
      "platform/app/src/server/app-layer/app.ts",
      "export function getApp() { return {}; }\nexport function tryGetApp() { return null; }",
    );
    write(usageFile, 'import { getApp } from "~/server/app-layer/app"; getApp();');
    baseline();

    expect(lintGlobalAppAccess(root)).toEqual([]);

    write(
      usageFile,
      'import { getApp } from "~/server/app-layer/app"; getApp();\nconst second = getApp();',
    );
    expect(lintGlobalAppAccess(root)).toEqual([
      expect.objectContaining({
        policy: "global-app-access",
        file: join(root, usageFile),
        line: 2,
      }),
    ]);
  });

  it("requires removed accesses to be removed from the baseline", () => {
    write(usageFile, 'import { tryGetApp } from "~/server/app-layer/app"; tryGetApp();');
    baseline();
    write(usageFile, "export const value = true;");

    expect(lintGlobalAppAccess(root)).toContainEqual(
      expect.objectContaining({
        policy: "global-app-access-baseline",
        message: expect.stringContaining("removed tryGetApp"),
      }),
    );
  });

  it("allows unrelated and shadowed names", () => {
    write(
      usageFile,
      [
        'import { getApp } from "~/server/app-layer/app";',
        'import { getApp as unrelated } from "./unrelated";',
        "function local(getApp: () => void) { getApp(); }",
        "{ const getApp = () => undefined; getApp(); }",
        "unrelated();",
      ].join("\n"),
    );

    expect(collectGlobalAppAccesses(root).map((access) => access.symbol)).toEqual(["getApp"]);
  });

  it("rejects a replacement even when the per-file count is unchanged", () => {
    write(
      usageFile,
      'import { getApp } from "~/server/app-layer/app";\nconst oldUse = getApp().old;',
    );
    baseline();
    write(
      usageFile,
      'import { getApp } from "~/server/app-layer/app";\nconst newUse = getApp().new;',
    );

    expect(lintGlobalAppAccess(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policy: "global-app-access" }),
        expect.objectContaining({ policy: "global-app-access-baseline" }),
      ]),
    );
  });
});
