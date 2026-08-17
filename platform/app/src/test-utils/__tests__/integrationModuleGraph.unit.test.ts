import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  graphLaneForSource,
  graphLaneSelection,
  partitionByModuleGraph,
  selectedGraphLane,
} from "../integrationModuleGraph";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "graph-lane-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFile(relative: string, source: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, source);
}

describe("graphLaneForSource", () => {
  describe("given a file that mocks a module", () => {
    it("keeps it on the mocking lane, because a hoisted mock cannot apply to a shared registry", () => {
      expect(graphLaneForSource('vi.mock("~/server/db");')).toBe("mocking");
      expect(graphLaneForSource("vi.doMock('./x');")).toBe("mocking");
      expect(graphLaneForSource("const { a } = vi.hoisted(() => ({ a: 1 }));")).toBe(
        "mocking",
      );
    });

    it("reads it through whitespace, the way it is actually written", () => {
      expect(graphLaneForSource("vi . mock ( './x' )")).toBe("mocking");
    });
  });

  describe("given a file that mocks nothing", () => {
    it("lets it share a registry", () => {
      expect(graphLaneForSource("import { prisma } from '~/server/db';")).toBe(
        "shared",
      );
    });

    it("is not fooled by other vi helpers, which do not touch the registry", () => {
      expect(graphLaneForSource("vi.fn(); vi.spyOn(x, 'y'); vi.useFakeTimers();")).toBe(
        "shared",
      );
    });
  });
});

describe("partitionByModuleGraph", () => {
  describe("given a mix of files", () => {
    it("splits them without losing or duplicating any", () => {
      writeFile("a.integration.test.ts", "vi.mock('./x');");
      writeFile("b.integration.test.ts", "expect(1).toBe(1);");
      writeFile("c.integration.test.ts", "vi.hoisted(() => ({}));");

      const { mocking, shared } = partitionByModuleGraph({
        root,
        files: [
          "a.integration.test.ts",
          "b.integration.test.ts",
          "c.integration.test.ts",
        ],
      });

      expect(mocking.sort()).toEqual([
        "a.integration.test.ts",
        "c.integration.test.ts",
      ]);
      expect(shared).toEqual(["b.integration.test.ts"]);
      expect([...mocking, ...shared]).toHaveLength(3);
    });
  });

  describe("given a file that cannot be read", () => {
    it("sends it to the mocking lane, because unreadable is not evidence sharing is safe", () => {
      const { mocking, shared } = partitionByModuleGraph({
        root,
        files: ["does-not-exist.integration.test.ts"],
      });

      expect(mocking).toEqual(["does-not-exist.integration.test.ts"]);
      expect(shared).toEqual([]);
    });
  });
});

describe("selectedGraphLane", () => {
  it("reads the two lane names and nothing else", () => {
    expect(selectedGraphLane({ INTEGRATION_GRAPH_LANE: "shared" })).toBe("shared");
    expect(selectedGraphLane({ INTEGRATION_GRAPH_LANE: "mocking" })).toBe("mocking");
    expect(selectedGraphLane({ INTEGRATION_GRAPH_LANE: "yes" })).toBeNull();
    expect(selectedGraphLane({})).toBeNull();
  });
});

describe("graphLaneSelection", () => {
  beforeEach(() => {
    writeFile("mocks.integration.test.ts", "vi.mock('./x');");
    writeFile("plain.integration.test.ts", "expect(1).toBe(1);");
  });

  const files = ["mocks.integration.test.ts", "plain.integration.test.ts"];

  describe("when no lane is selected", () => {
    it("runs every file with a fresh registry, so a laptop behaves as before the split", () => {
      const selection = graphLaneSelection({ root, datastoreFiles: files, env: {} });

      expect(selection.files).toEqual(files);
      expect(selection.isolate).toBe(true);
    });
  });

  describe("when the shared lane is selected", () => {
    /** Files and isolation come from one call so they cannot disagree. */
    it("runs only the non-mocking files, and only then shares the registry", () => {
      const selection = graphLaneSelection({
        root,
        datastoreFiles: files,
        env: { INTEGRATION_GRAPH_LANE: "shared" },
      });

      expect(selection.files).toEqual(["plain.integration.test.ts"]);
      expect(selection.isolate).toBe(false);
    });
  });

  describe("when the mocking lane is selected", () => {
    it("runs only the mocking files, with isolation kept on", () => {
      const selection = graphLaneSelection({
        root,
        datastoreFiles: files,
        env: { INTEGRATION_GRAPH_LANE: "mocking" },
      });

      expect(selection.files).toEqual(["mocks.integration.test.ts"]);
      expect(selection.isolate).toBe(true);
    });
  });

  describe("across both lanes", () => {
    it("covers every datastore file exactly once", () => {
      const mocking = graphLaneSelection({
        root,
        datastoreFiles: files,
        env: { INTEGRATION_GRAPH_LANE: "mocking" },
      }).files;
      const shared = graphLaneSelection({
        root,
        datastoreFiles: files,
        env: { INTEGRATION_GRAPH_LANE: "shared" },
      }).files;

      expect([...mocking, ...shared].sort()).toEqual([...files].sort());
    });
  });
});
