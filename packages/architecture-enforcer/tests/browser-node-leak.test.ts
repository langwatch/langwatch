import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintBrowserNodeLeaks } from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-browser-node-leak-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writePackage(path: string, name: string, dependencies: Record<string, string> = {}): void {
  write(
    join(path, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      main: "./src/index.ts",
      exports: { ".": "./src/index.ts" },
      dependencies,
    }),
  );
}

describe("when a browser-reachable package's own entry imports a Node builtin", () => {
  /** @scenario "A contract package directly importing a Node builtin is reported" */
  it("reports the file that imports the prefixed builtin", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract");
    write(
      "modules/trace/contract/src/index.ts",
      'import crypto from "node:crypto";\nexport { crypto };\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("node:crypto");
    expect(violations[0]?.file).toContain("modules/trace/contract/src/index.ts");
  });

  /** @scenario "A bare specifier without the node: prefix is still reported" */
  it("reports the file that imports the bare builtin spelling", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract");
    write(
      "modules/trace/contract/src/index.ts",
      'import crypto from "crypto";\nexport { crypto };\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("crypto");
  });

  /** @scenario "A require() of a Node builtin inside a function is reported" */
  it("reports a dynamic require() of a Node builtin", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract");
    write(
      "modules/trace/contract/src/index.ts",
      'export function instance() {\n  const os = require("node:os");\n  return os;\n}\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("node:os");
  });
});

describe("when a Node builtin is reached only through a package the contract depends on", () => {
  /** @scenario "A Node builtin reached only through another package is reported" */
  it("reports the framework package's file, not the contract's own file", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract", {
      "@langwatch/ksuid": "workspace:*",
    });
    write("modules/trace/contract/src/index.ts", 'export { generate } from "@langwatch/ksuid";\n');
    writePackage("packages/ksuid", "@langwatch/ksuid");
    write(
      "packages/ksuid/src/index.ts",
      'import { readFileSync } from "node:fs";\nexport function generate() { return readFileSync; }\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("node:fs");
    expect(violations[0]?.file).toContain("packages/ksuid/src/index.ts");
  });
});

describe("when the import is erased at compile time", () => {
  /** @scenario "An import type of a Node-importing module is not reported" */
  it("does not report a type-only import of a Node-importing module", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract");
    write(
      "modules/trace/contract/src/index.ts",
      'import type { Thing } from "./node-importer.ts";\nexport type { Thing };\n',
    );
    write(
      "modules/trace/contract/src/node-importer.ts",
      'import { spawn } from "node:child_process";\nexport type Thing = ReturnType<typeof spawn>;\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });

  /** @scenario "An export type re-export of a Node-importing module is not reported" */
  it("does not report an export-type re-export of a Node-importing module", () => {
    writePackage("modules/trace/contract", "@langwatch/trace-contract");
    write(
      "modules/trace/contract/src/index.ts",
      'export type { Thing } from "./node-importer.ts";\n',
    );
    write(
      "modules/trace/contract/src/node-importer.ts",
      'import { spawn } from "node:child_process";\nexport type Thing = ReturnType<typeof spawn>;\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });
});

describe("when the importing package is never browser-reachable", () => {
  /** @scenario "A server package outside the browser-reachable set is not reported" */
  it("reports nothing for a process package's own Node import", () => {
    writePackage("modules/trace/process", "@langwatch/trace-process");
    write(
      "modules/trace/process/src/index.ts",
      'import { readFileSync } from "node:fs";\nexport { readFileSync };\n',
    );

    const violations = lintBrowserNodeLeaks(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });
});
