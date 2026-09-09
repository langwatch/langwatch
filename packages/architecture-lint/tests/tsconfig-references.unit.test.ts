import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      packageFixture("enterprise/modules/sso/server", "@langwatch/sso-server", {
        dependencies: { "@langwatch/time": "workspace:*" },
      });
    });

    it("derives the reference relative to the module's own directory", () => {
      expect(referencesOf("enterprise/modules/sso/server/tsconfig.build.json")).toEqual([
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

  describe("when an application owns a declarations solution and no build config", () => {
    beforeEach(() => {
      write("packages/platform-api/package.json", {
        name: "@langwatch/platform-api",
        dependencies: { "@langwatch/time": "workspace:*" },
      });
      write("packages/platform-api/tsconfig.json", {});
      write("packages/platform-api/tsconfig.declarations.json", { references: [] });
    });

    it("derives the solution's references", () => {
      expect(referencesOf("packages/platform-api/tsconfig.declarations.json")).toEqual([
        "../time/tsconfig.build.json",
      ]);
    });

    it("leaves the application's own tsconfig.json out of the derivation", () => {
      const files = deriveWorkspaceReferences(root).map((project) => project.file);

      expect(files).not.toContain(join(root, "packages/platform-api/tsconfig.json"));
    });
  });
});

describe("given the cyclic web group", () => {
  beforeEach(() => {
    write("dev/tsconfig.web-declarations.json", {
      langwatchDeclarationGroup: { members: [{ directory: "../modules/annotation/web" }] },
    });
    packageFixture("modules/annotation/web", "@langwatch/annotation-web", {
      dependencies: { "@langwatch/design-system": "workspace:*" },
    });
    packageFixture("modules/trace/web", "@langwatch/trace-web", {
      dependencies: { "@langwatch/annotation-web": "workspace:*" },
    });
  });

  describe("when the package is a member of the group", () => {
    it("produces through the group solution alone", () => {
      expect(referencesOf("modules/annotation/web/tsconfig.build.json")).toEqual([
        "../../../dev/tsconfig.web-declarations.json",
      ]);
    });

    it("references the group first and then its own dependencies", () => {
      expect(referencesOf("modules/annotation/web/tsconfig.json")).toEqual([
        "../../../dev/tsconfig.web-declarations.json",
        "../../../packages/design-system/tsconfig.build.json",
      ]);
    });
  });

  describe("when a package outside the group depends on a member", () => {
    it("references the member's own build config", () => {
      expect(referencesOf("modules/trace/web/tsconfig.build.json")).toEqual([
        "../../annotation/web/tsconfig.build.json",
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
