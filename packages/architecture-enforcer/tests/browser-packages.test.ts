import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintPolicies, POLICIES } from "../src/index.ts";
import {
  lintBrowserKitDependencies,
  lintBrowserKitExports,
  lintBrowserPackageClosure,
  lintBrowserPackageExports,
  lintBrowserPackageManifestClosure,
} from "../src/policies/frontend/browser-packages.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-browser-packages-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writePackage(
  path: string,
  name: string,
  options: {
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  } = {},
): void {
  write(
    join(path, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      main: "./src/index.ts",
      exports: options.exports ?? { ".": "./src/index.ts" },
      dependencies: options.dependencies ?? {},
      peerDependencies: options.peerDependencies ?? {},
    }),
  );
}

describe("when a module's browser package is imported from outside its own directory", () => {
  /** @scenario "A cross-module import of a browser package is reported" */
  it("reports a standard `from` import naming another module's browser package", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser");
    write(
      "modules/scenario/browser/src/index.ts",
      'import { x } from "@langwatch/trace-browser";\n',
    );

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("@langwatch/trace-browser");
    expect(violations[0]?.file).toContain("modules/scenario/browser/src/index.ts");
  });

  /** @scenario "A bare side-effect import of a browser package is reported" */
  it("reports a bare side-effect import with no binding", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser");
    write(
      "modules/scenario/browser/src/index.ts",
      'import "@langwatch/trace-browser/surfaces/theme.css";\n',
    );

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("@langwatch/trace-browser/surfaces/theme.css");
  });

  /** @scenario "A re-export naming a browser package is reported" */
  it("reports an `export ... from` re-export", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser");
    write(
      "modules/scenario/browser/src/index.ts",
      'export { traceApi } from "@langwatch/trace-browser/surfaces/api";\n',
    );

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("@langwatch/trace-browser/surfaces/api");
  });

  /** @scenario "A type-position dynamic import naming a browser package is reported" */
  it("reports a `typeof import(...)` type-position reference", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser");
    write(
      "modules/scenario/browser/src/__tests__/mock.test.ts",
      'vi.importOriginal<typeof import("@langwatch/trace-browser/surfaces/api")>();\n',
    );

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("@langwatch/trace-browser/surfaces/api");
  });

  /** @scenario "apps/ui may import a browser package" */
  it("does not report apps/ui, which installs browser halves", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("apps/ui", "@langwatch/ui");
    write("apps/ui/src/main.tsx", 'import "@langwatch/trace-browser";\n');

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });

  /** @scenario "A browser package's own files may import themselves" */
  it("does not report a browser package importing its own subpath", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    write(
      "modules/trace/browser/src/other.ts",
      'export { x } from "@langwatch/trace-browser/surfaces/api";\n',
    );

    const violations = lintBrowserPackageClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });
});

describe("when a package.json declares a dependency on another module's browser package", () => {
  /** @scenario "A manifest dependency edge onto a browser package is reported" */
  it("reports the edge whether or not any source file uses it", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser", {
      dependencies: { "@langwatch/trace-browser": "workspace:*" },
    });

    const violations = lintBrowserPackageManifestClosure(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("@langwatch/trace-browser");
    expect(violations[0]?.file).toContain("modules/scenario/browser/package.json");
  });
});

describe("when a browser package's exports map declares more than ./declaration", () => {
  /** @scenario "A browser package with a surfaces/* export entry is reported" */
  it("reports every entry other than ./declaration", () => {
    writePackage("modules/trace/browser", "@langwatch/trace-browser", {
      exports: {
        "./declaration": "./src/trace.web.ts",
        "./surfaces/trace-host": "./src/behavior/trace-host.ts",
        ".": "./src/index.ts",
      },
    });

    const violations = lintBrowserPackageExports(snapshotOf({ root }));

    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.specifier!).toSorted((a, b) => a.localeCompare(b))).toEqual([
      ".",
      "./surfaces/trace-host",
    ]);
  });
});

describe("when a kit's exports map declares more than .", () => {
  /** @scenario "A kit with a named subpath export entry is reported" */
  it("reports every entry other than .", () => {
    writePackage("modules/trace/browser-kit", "@langwatch/trace-browser-kit", {
      exports: { ".": "./src/index.ts", "./trace-drawer-chip": "./src/trace-drawer-chip.tsx" },
    });

    const violations = lintBrowserKitExports(snapshotOf({ root }));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe("./trace-drawer-chip");
  });
});

describe("when a kit's dependencies reach outside contracts, the Design System and browser-host", () => {
  /** @scenario "A kit depending on a browser or a sibling kit is reported" */
  it("reports a dependency on another module's browser package and on another kit", () => {
    writePackage("modules/trace/browser-kit", "@langwatch/trace-browser-kit", {
      dependencies: {
        "@langwatch/scenario-browser": "workspace:*",
        "@langwatch/dataset-browser-kit": "workspace:*",
        "@langwatch/trace-contract": "workspace:*",
        "@langwatch/design-system": "workspace:*",
        "@langwatch/browser-host": "workspace:*",
      },
    });

    const violations = lintBrowserKitDependencies(snapshotOf({ root }));

    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.specifier!).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "@langwatch/dataset-browser-kit",
      "@langwatch/scenario-browser",
    ]);
  });

  /** @scenario "A kit's contract, Design System and browser-host dependencies pass" */
  it("does not report contracts, the Design System, or browser-host", () => {
    writePackage("modules/trace/browser-kit", "@langwatch/trace-browser-kit", {
      dependencies: {
        "@langwatch/trace-contract": "workspace:*",
        "@langwatch/scenario-contract": "workspace:*",
        "@langwatch/design-system": "workspace:*",
        "@langwatch/browser-host": "workspace:*",
      },
    });

    const violations = lintBrowserKitDependencies(snapshotOf({ root }));

    expect(violations).toHaveLength(0);
  });
});

describe("when one manifest edge onto a browser package could be read by three policies", () => {
  /** @scenario "One manifest edge onto a browser package is reported once" */
  it("reports it under the manifest closure alone, not again as cross-feature or kit debt", () => {
    write(
      "modules/catalogue.json",
      JSON.stringify({
        version: 0,
        features: [
          {
            id: "scenario",
            root: "modules/scenario",
            classification: "core",
            subjects: ["scenario"],
          },
          { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
        ],
      }),
    );
    writePackage("modules/trace/browser", "@langwatch/trace-browser");
    writePackage("modules/scenario/browser", "@langwatch/scenario-browser", {
      dependencies: { "@langwatch/trace-browser": "workspace:*" },
    });
    writePackage("modules/trace/browser-kit", "@langwatch/trace-browser-kit", {
      dependencies: { "@langwatch/scenario-browser": "workspace:*" },
    });

    const registry = POLICIES.filter((policy) =>
      ["browser-package-closure", "browser-kit-dependencies", "manifests"].includes(policy.id),
    );
    const edges = lintPolicies(snapshotOf({ root }), registry)
      .filter((violation) => violation.specifier?.endsWith("-browser"))
      .map((violation) => `${violation.policy} ${violation.file} ${violation.specifier}`);

    expect(edges).toEqual([
      "browser-package-manifest-closure modules/scenario/browser/package.json @langwatch/trace-browser",
      "browser-package-manifest-closure modules/trace/browser-kit/package.json @langwatch/scenario-browser",
    ]);
  });
});
