import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveWorkspaceReferences,
  renderReferences,
} from "../src/workspace/tsconfig-references.ts";

let root = "";

function write(relative: string, content: unknown): void {
  const file = join(root, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function packageFixture(
  directory: string,
  name: string,
  manifest: Record<string, unknown> = {},
): void {
  write(`${directory}/package.json`, { name, ...manifest });
  write(`${directory}/tsconfig.json`, { references: [] });
  write(`${directory}/tsconfig.build.json`, { references: [] });
}

function referencesOf(file: string): readonly string[] {
  const project = deriveWorkspaceReferences(root).find(
    (candidate) => candidate.file === join(root, file),
  );

  return project?.references ?? [];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tsconfig-references-"));
  write(
    "pnpm-workspace.yaml",
    ["packages:", '  - "packages/*"', '  - "modules/*/*"', '  - "enterprise/modules/*/*"', ""].join(
      "\n",
    ),
  );
  packageFixture("packages/time", "@langwatch/time");
  packageFixture("packages/design-system", "@langwatch/design-system");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("given a workspace whose packages declare their dependencies", () => {
  describe("when a plain package depends on another", () => {
    beforeEach(() => {
      packageFixture("packages/api", "@langwatch/api", {
        dependencies: { "@langwatch/time": "workspace:*", zod: "^4.0.0" },
      });
    });

    it("derives one build reference per workspace dependency that produces declarations", () => {
      expect(referencesOf("packages/api/tsconfig.build.json")).toEqual([
        "../time/tsconfig.build.json",
      ]);
    });

    it("puts the package's own producer first in the consumer config", () => {
      expect(referencesOf("packages/api/tsconfig.json")).toEqual([
        "tsconfig.build.json",
        "../time/tsconfig.build.json",
      ]);
    });
  });

  describe("when a dependency is declared only for development", () => {
    beforeEach(() => {
      packageFixture("packages/api", "@langwatch/api", {
        devDependencies: { "@langwatch/time": "workspace:*" },
      });
    });

    it("keeps the development dependency out of the build references", () => {
      expect(referencesOf("packages/api/tsconfig.build.json")).toEqual([]);
    });

    it("references the development dependency from the consumer config", () => {
      expect(referencesOf("packages/api/tsconfig.json")).toEqual([
        "tsconfig.build.json",
        "../time/tsconfig.build.json",
      ]);
    });
  });

  describe("when an enterprise module depends on a shared package", () => {
    beforeEach(() => {
      packageFixture("enterprise/modules/sso/process", "@langwatch/sso-server", {
        dependencies: { "@langwatch/time": "workspace:*" },
      });
    });

    it("derives the reference relative to the module's own directory", () => {
      expect(referencesOf("enterprise/modules/sso/process/tsconfig.build.json")).toEqual([
        "../../../../packages/time/tsconfig.build.json",
      ]);
    });
  });

  describe("when the build config emits JavaScript rather than declarations", () => {
    beforeEach(() => {
      packageFixture("packages/mail", "@langwatch/mail", {
        dependencies: { "@langwatch/time": "workspace:*" },
      });
      write("packages/mail/tsconfig.build.json", {
        compilerOptions: { declaration: false },
        references: [],
      });
      write("packages/mail/tsconfig.declarations.json", { references: [] });
      packageFixture("packages/api", "@langwatch/api", {
        dependencies: { "@langwatch/mail": "workspace:*" },
      });
    });

    it("makes the package's declarations solution the producer consumers reference", () => {
      expect(referencesOf("packages/api/tsconfig.build.json")).toEqual([
        "../mail/tsconfig.declarations.json",
      ]);
    });

    it("puts that solution first in the package's own consumer config", () => {
      expect(referencesOf("packages/mail/tsconfig.json")).toEqual([
        "tsconfig.declarations.json",
        "../time/tsconfig.build.json",
      ]);
    });
  });

  describe("when an application owns no build config", () => {
    beforeEach(() => {
      write("packages/platform-api/package.json", {
        name: "@langwatch/platform-api",
        dependencies: { "@langwatch/time": "workspace:*" },
      });
      write("packages/platform-api/tsconfig.json", {});
      write("packages/platform-api/tsconfig.test.json", {});
    });

    // An application produces no declarations of its own, so it names only what
    // it consumes. It still carries them: they are what `tsc -b` walks to build
    // its dependencies before checking it.
    it("derives its dependencies onto its own tsconfig.json", () => {
      expect(referencesOf("packages/platform-api/tsconfig.json")).toEqual([
        "../time/tsconfig.build.json",
      ]);
    });

    // `extends` does not inherit `references`, so the config the check actually
    // runs against states the graph again or reaches none of it.
    it("derives them onto the test config too", () => {
      expect(referencesOf("packages/platform-api/tsconfig.test.json")).toEqual([
        "../time/tsconfig.build.json",
      ]);
    });
  });
});

describe("given the cyclic web group", () => {
  beforeEach(() => {
    write("dev/tsconfig.web-declarations.json", {
      langwatchDeclarationGroup: { members: [{ directory: "../modules/annotation/browser" }] },
    });
    packageFixture("modules/annotation/browser", "@langwatch/annotation-browser", {
      dependencies: { "@langwatch/design-system": "workspace:*" },
    });
    packageFixture("modules/trace/browser", "@langwatch/trace-browser", {
      dependencies: { "@langwatch/annotation-browser": "workspace:*" },
    });
  });

  describe("when the package is a member of the group", () => {
    it("produces through the group solution alone", () => {
      expect(referencesOf("modules/annotation/browser/tsconfig.build.json")).toEqual([
        "../../../dev/tsconfig.web-declarations.json",
      ]);
    });

    it("references the group first and then its own dependencies", () => {
      expect(referencesOf("modules/annotation/browser/tsconfig.json")).toEqual([
        "../../../dev/tsconfig.web-declarations.json",
        "../../../packages/design-system/tsconfig.build.json",
      ]);
    });
  });

  describe("when a package outside the group depends on a member", () => {
    // The group compiles its members together, so no member's own build config
    // is composite and `tsc -b` refuses any reference to one. Every consumer
    // produces through the solution, inside the group or outside it.
    it("produces through the group solution as well", () => {
      expect(referencesOf("modules/trace/browser/tsconfig.build.json")).toEqual([
        "../../../dev/tsconfig.web-declarations.json",
      ]);
    });
  });
});

describe("given a config carrying a hand entry no rule derives", () => {
  beforeEach(() => {
    packageFixture("packages/api", "@langwatch/api");
    write("packages/api/tsconfig.build.json", {
      references: [{ path: "../design-system/tsconfig.build.json" }],
      langwatchExtraReferences: [{ path: "../design-system/tsconfig.build.json" }],
    });
    write("packages/api/tsconfig.json", {
      references: [{ path: "../time/tsconfig.build.json" }],
    });
  });

  it("keeps an entry recorded under langwatchExtraReferences", () => {
    expect(referencesOf("packages/api/tsconfig.build.json")).toEqual([
      "../design-system/tsconfig.build.json",
    ]);
  });

  it("reports an unrecorded entry as undeducible", () => {
    const project = deriveWorkspaceReferences(root).find(
      (candidate) => candidate.file === join(root, "packages/api/tsconfig.json"),
    );

    expect(project?.undeducible).toEqual(["../time/tsconfig.build.json"]);
  });
});

describe("given a config with content around its references", () => {
  it("replaces the references array and leaves every other byte alone", () => {
    const text = [
      "{",
      "  // The comment survives.",
      '  "extends": "../../tsconfig.base.json",',
      '  "references": [',
      "    {",
      '      "path": "old/tsconfig.build.json"',
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n");

    expect(renderReferences(text, ["new/tsconfig.build.json"])).toBe(
      text.replace("old/tsconfig.build.json", "new/tsconfig.build.json"),
    );
  });

  it("adds a references array to a config that carries none", () => {
    const text = ["{", '  "extends": "../../tsconfig.base.json"', "}", ""].join("\n");

    expect(renderReferences(text, ["a/tsconfig.build.json"])).toBe(
      [
        "{",
        '  "extends": "../../tsconfig.base.json",',
        '  "references": [',
        "    {",
        '      "path": "a/tsconfig.build.json"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes an empty array when nothing is derived", () => {
    const file = join(root, "packages/time/tsconfig.build.json");

    expect(renderReferences(readFileSync(file, "utf8"), [])).toContain('"references": []');
  });
});

// These three run the real compiler over real files rather than stubbing it,
// which is the only way to prove the build order. That costs seconds, not the
// milliseconds the default budget assumes.
const REAL_BUILD_TIMEOUT_MS = 60_000;

describe("given a package's project actually references its adopted dependency", () => {
  let buildRoot = "";

  beforeEach(() => {
    buildRoot = mkdtempSync(join(tmpdir(), "tsconfig-references-build-"));
  });

  afterEach(() => {
    rmSync(buildRoot, { recursive: true, force: true });
  });

  function writeProject(
    relative: string,
    sourceText: string,
    options: Record<string, unknown> = {},
  ): string {
    const directory = join(buildRoot, relative);
    mkdirSync(join(directory, "src"), { recursive: true });
    writeFileSync(join(directory, "src/index.ts"), sourceText);
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          outDir: "dist",
          rootDir: "src",
          skipLibCheck: true,
          module: "commonjs",
          target: "es2020",
          noEmitOnError: true,
        },
        include: ["src"],
        ...options,
      }),
    );
    return directory;
  }

  function build(entry: string) {
    const host = ts.createSolutionBuilderHost(
      ts.sys,
      undefined,
      () => {},
      () => {},
    );
    return ts.createSolutionBuilder(host, [entry], {}).build();
  }

  function semanticDiagnosticCount(directory: string): number {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(directory, "tsconfig.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (error) => {
          throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
        },
      },
    );
    if (!parsed) throw new Error("The project config could not be parsed");
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false });
    return program.getSemanticDiagnostics().length;
  }

  function writeDependencyAndConsumer() {
    const dependency = writeProject("dependency", "export const value = 1;");
    const consumer = writeProject(
      "consumer",
      'import { value } from "../../dependency/dist/index";\nexport const doubled: number = value * 2;',
      { references: [{ path: "../dependency" }] },
    );
    return { dependency, consumer };
  }

  describe("when the package is typechecked", () => {
    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "builds the dependency's declarations first and resolves them instead of its source",
      () => {
        const { dependency, consumer } = writeDependencyAndConsumer();

        expect(build(consumer)).toBe(ts.ExitStatus.Success);
        expect(existsSync(join(dependency, "dist/index.d.ts"))).toBe(true);
        expect(existsSync(join(consumer, "dist/index.js"))).toBe(true);
      },
      REAL_BUILD_TIMEOUT_MS,
    );

    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "still reports a type error against the dependency's own exports",
      () => {
        const { consumer } = writeDependencyAndConsumer();
        build(consumer);

        writeFileSync(
          join(consumer, "src/index.ts"),
          'import { value } from "../../dependency/dist/index";\nexport const bad: string = value;',
        );

        expect(semanticDiagnosticCount(consumer)).toBeGreaterThan(0);
      },
      REAL_BUILD_TIMEOUT_MS,
    );

    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "a failed dependency build stops the package's own build",
      () => {
        const { dependency, consumer } = writeDependencyAndConsumer();
        build(consumer);

        writeFileSync(
          join(dependency, "src/index.ts"),
          'export const value: number = "not a number";',
        );
        rmSync(join(dependency, "dist"), { recursive: true, force: true });
        rmSync(join(consumer, "dist"), { recursive: true, force: true });

        expect(build(consumer)).not.toBe(ts.ExitStatus.Success);
        expect(existsSync(join(dependency, "dist/index.d.ts"))).toBe(false);
        expect(existsSync(join(consumer, "dist/index.js"))).toBe(false);
      },
      REAL_BUILD_TIMEOUT_MS,
    );
  });
});

describe("given the workspace solution the root typecheck builds", () => {
  beforeEach(() => {
    write("tsconfig.json", { files: [], references: [] });
  });

  describe("when a member declares a typecheck script", () => {
    beforeEach(() => {
      packageFixture("packages/checked", "@langwatch/checked", {
        scripts: { typecheck: "tsc -b" },
      });
    });

    it("names that member's check root", () => {
      expect(referencesOf("tsconfig.json")).toContain("packages/checked/tsconfig.json");
    });
  });

  describe("when a member declares no typecheck script", () => {
    beforeEach(() => {
      packageFixture("packages/unchecked", "@langwatch/unchecked");
    });

    it("leaves it out, because nothing checks it today either", () => {
      expect(referencesOf("tsconfig.json")).not.toContain("packages/unchecked/tsconfig.json");
    });
  });

  describe("when a member owns a widened test config", () => {
    beforeEach(() => {
      packageFixture("packages/widened", "@langwatch/widened", {
        scripts: { typecheck: "tsc -b tsconfig.test.json" },
      });
      write("packages/widened/tsconfig.test.json", { references: [] });
    });

    it("names the widened config instead of the one it widens", () => {
      const references = referencesOf("tsconfig.json");

      expect(references).toContain("packages/widened/tsconfig.test.json");
      expect(references).not.toContain("packages/widened/tsconfig.json");
    });
  });

  describe("when a check root belongs to no workspace member", () => {
    beforeEach(() => {
      write("tsconfig.json", {
        files: [],
        langwatchExtraReferences: [{ path: "packages/time/preview/tsconfig.json" }],
        references: [],
      });
    });

    it("keeps the entry the solution names by hand", () => {
      expect(referencesOf("tsconfig.json")).toContain("packages/time/preview/tsconfig.json");
    });
  });
});
