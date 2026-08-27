import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import picomatch from "picomatch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INTEGRATION_SEARCH_DIRS,
  laneForSource,
  partitionIntegrationFiles,
  toIncludePatterns,
} from "../integrationLanes";

/** Binds specs/ci/integration-test-lanes.feature. */
describe("integration test lanes", () => {
  const jsdomHeader = "/** @vitest-environment jsdom */\n";

  describe("given a test file declaring the jsdom environment", () => {
    /** @scenario "A jsdom test that names no datastore runs without one" */
    it("runs in the component lane when it names no datastore", () => {
      const source = `${jsdomHeader}
        import { render } from "@testing-library/react";
        import { Button } from "@langwatch/trace-server";
        it("renders", () => { render(<Button />); });
      `;

      expect(laneForSource(source)).toBe("component");
    });

    /** @scenario "A jsdom test that reaches for a datastore keeps its datastore" */
    it("runs in the datastore lane when it names one", () => {
      const source = `${jsdomHeader}
        import { prisma } from "~/server/db";
        it("reads", async () => { await prisma.project.findMany(); });
      `;

      expect(laneForSource(source)).toBe("datastore");
    });

    /** @scenario "Every datastore a test could reach sends it to the datastore lane" */
    it.each(["prisma", "clickhouse", "redis", "bullmq", "groupQueue"])(
      "sends a file naming %s to the datastore lane",
      (dependency) => {
        expect(laneForSource(`${jsdomHeader}import x from "${dependency}";`)).toBe(
          "datastore",
        );
      },
    );

    /** @scenario "Every datastore a test could reach sends it to the datastore lane" */
    it("matches a datastore name whatever its casing", () => {
      expect(laneForSource(`${jsdomHeader}import { ClickHouseClient } from "x";`)).toBe(
        "datastore",
      );
    });
  });

  describe("given a test file that does not declare the jsdom environment", () => {
    /** @scenario "A node-environment test keeps its datastore" */
    it("runs in the datastore lane", () => {
      expect(laneForSource(`it("does a thing", () => {});`)).toBe("datastore");
    });

    /** @scenario "A new test file with no marker at all runs in the datastore lane" */
    it("runs in the datastore lane even when it names no datastore either", () => {
      expect(laneForSource("export {};")).toBe("datastore");
    });
  });

  describe("when a lane's file list becomes include patterns", () => {
    /** @scenario "A path containing a Next.js route segment matches only itself" */
    it("escapes a Next.js route segment so it matches only itself", () => {
      const [pattern] = toIncludePatterns([
        "src/pages/[project]/__tests__/a.integration.test.tsx",
      ]);

      expect(pattern).toBe("src/pages/\\[project\\]/__tests__/a.integration.test.tsx");
      // Unescaped, `[project]` is a character class, so this is what the glob
      // would have matched instead of the real directory.
      expect(
        picomatch.isMatch("src/pages/p/__tests__/a.integration.test.tsx", pattern!),
      ).toBe(false);
      expect(
        picomatch.isMatch(
          "src/pages/[project]/__tests__/a.integration.test.tsx",
          pattern!,
        ),
      ).toBe(true);
    });

    /** @scenario "Pattern syntax in a path is escaped" */
    it.each([
      ["a square bracket", "a[1].test.ts", "a\\[1\\].test.ts"],
      ["a brace", "a{b}.test.ts", "a\\{b\\}.test.ts"],
      ["a parenthesis", "a(b).test.ts", "a\\(b\\).test.ts"],
      ["an asterisk", "a*b.test.ts", "a\\*b.test.ts"],
      ["a question mark", "a?b.test.ts", "a\\?b.test.ts"],
    ])("escapes %s", (_label, input, expected) => {
      expect(toIncludePatterns([input])).toEqual([expected]);
    });

    /** @scenario "An ordinary path is left alone" */
    it("leaves an ordinary path unchanged", () => {
      const path = "src/components/__tests__/Button.integration.test.tsx";
      expect(toIncludePatterns([path])).toEqual([path]);
    });
  });

  describe("given a tree of integration test files", () => {
    let root: string;

    const write = (relative: string, contents: string) => {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    };

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), "lanes-"));
      write("src/components/Button.integration.test.tsx", `${jsdomHeader}render();`);
      write("src/components/Table.integration.test.tsx", `${jsdomHeader}render();`);
      write(
        "src/components/Grid.integration.test.tsx",
        `${jsdomHeader}import { prisma } from "~/server/db";`,
      );
      write("src/server/api.integration.test.ts", `import { prisma } from "x";`);
      write("ee/governance/gate.integration.test.ts", `import { redis } from "x";`);
      // Neighbours that must not be swept in.
      write("src/components/Button.unit.test.tsx", `${jsdomHeader}render();`);
      write("src/components/Button.tsx", "export const Button = () => null;");
      write("node_modules/pkg/thing.integration.test.ts", `${jsdomHeader}render();`);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    /** @scenario "No integration file is dropped from CI" */
    it("places every integration file in one lane or the other", () => {
      const { component, datastore } = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });

      expect([...component, ...datastore].sort()).toEqual([
        "ee/governance/gate.integration.test.ts",
        "src/components/Button.integration.test.tsx",
        "src/components/Grid.integration.test.tsx",
        "src/components/Table.integration.test.tsx",
        "src/server/api.integration.test.ts",
      ]);
    });

    /** @scenario "No integration file runs twice" */
    it("places no file in both lanes", () => {
      const { component, datastore } = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });

      expect(component.filter((file) => datastore.includes(file))).toEqual([]);
    });

    /** @scenario "No integration file is dropped from CI" */
    it("leaves unit tests, source files and node_modules alone", () => {
      const { component, datastore } = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });
      const all = [...component, ...datastore];

      expect(all).not.toContain("src/components/Button.unit.test.tsx");
      expect(all).not.toContain("src/components/Button.tsx");
      expect(all.some((file) => file.includes("node_modules"))).toBe(false);
    });

    /** @scenario "A jsdom test that names no datastore runs without one" */
    it("routes the jsdom files that name no datastore to the component lane", () => {
      const { component } = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });

      expect(component).toEqual([
        "src/components/Button.integration.test.tsx",
        "src/components/Table.integration.test.tsx",
      ]);
    });

    /** @scenario "The partition is stable across the processes that compute it" */
    it("returns the same files in the same order on a second pass", () => {
      const first = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });
      const second = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });

      expect(second).toEqual(first);
    });

    /** @scenario "A file that cannot be read runs where everything is available" */
    it("sends a file it cannot read to the datastore lane", () => {
      // A dangling symlink: readdir reports it as neither a directory nor a
      // regular file, so the walk collects it on the suffix, and the read then
      // fails. The lane must not read "no datastore named" out of that.
      symlinkSync(
        path.join(root, "src/nowhere.ts"),
        path.join(root, "src/broken.integration.test.ts"),
      );

      const { component, datastore } = partitionIntegrationFiles({
        root,
        searchDirs: [...INTEGRATION_SEARCH_DIRS],
      });

      expect(component).not.toContain("src/broken.integration.test.ts");
      expect(datastore).toContain("src/broken.integration.test.ts");
    });
  });
});
