import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cachedBinaryIsUsable,
  digestGoSources,
  readStamp,
  writeStamp,
} from "./_nlpgoBinaryStamp";

/**
 * Binds specs/ci/nlpgo-test-binary-reuse.feature.
 *
 * Uses a real temp tree rather than a mocked fs: the bug being guarded against
 * was a filesystem-semantics bug (git does not restore mtimes), so a test that
 * mocks the filesystem away cannot observe the thing that broke.
 */
describe("nlpgo test binary stamp", () => {
  let root: string;
  let watchDirs: string[];
  let watchFiles: string[];

  const write = (relative: string, contents: string) => {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
    return full;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nlpgo-stamp-"));
    watchDirs = [
      path.join(root, "services", "nlpgo"),
      path.join(root, "cmd", "service"),
      path.join(root, "pkg"),
      path.join(root, "sdks", "go"),
    ];
    watchFiles = [
      path.join(root, "go.mod"),
      path.join(root, "go.sum"),
      path.join(root, "go.work"),
    ];
    write("services/nlpgo/main.go", "package main\n");
    write("services/nlpgo/inner/util.go", "package inner\n");
    write("cmd/service/main.go", "package main\n");
    write("go.mod", "module example.com/x\n");
    write("go.work", "go 1.24\n");
    write("sdks/go/prompts/prompts.go", "package prompts\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("given a cached binary and a digest of the sources it was built from", () => {
    let binaryPath: string;
    let stampPath: string;

    beforeEach(() => {
      binaryPath = write(".vitest-tmp/nlpgo-test", "binary");
      stampPath = `${binaryPath}.stamp`;
      writeStamp(stampPath, digestGoSources({ watchDirs, watchFiles, root }));
    });

    /** @scenario "A checkout does not on its own force a rebuild" */
    it("reuses the binary when checkout has moved every source mtime past it", () => {
      // What actions/checkout does to a tree: every source file is written
      // fresh, so it carries a time far newer than the restored binary.
      const future = new Date(Date.now() + 60_000);
      for (const relative of [
        "services/nlpgo/main.go",
        "services/nlpgo/inner/util.go",
        "cmd/service/main.go",
      ]) {
        utimesSync(path.join(root, relative), future, future);
      }

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, watchFiles, root }),
        }),
      ).toBe(true);
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("rebuilds when a Go source changed", () => {
      write("services/nlpgo/main.go", "package main\n// edited\n");

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, watchFiles, root }),
        }),
      ).toBe(false);
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("records the current digest when the stamp is rewritten", () => {
      write("services/nlpgo/main.go", "package main\n// edited\n");
      const rebuilt = digestGoSources({ watchDirs, watchFiles, root });
      writeStamp(stampPath, rebuilt);

      expect(readStamp(stampPath)).toBe(rebuilt);
      expect(
        cachedBinaryIsUsable({ binaryPath, stampPath, currentDigest: rebuilt }),
      ).toBe(true);
    });

    // The stamp is written only AFTER a build succeeds, so a failed compile
    // leaves the previous one in place. What the next run then sees is a stamp
    // that disagrees with the current sources — and it must rebuild rather than
    // run whatever binary happens to be sitting there.
    /** @scenario "A failed compile is not recorded as a success" */
    it("rebuilds when the stamp still describes the sources before the change", () => {
      write("services/nlpgo/main.go", "package main\n// the edit that failed\n");

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, watchFiles, root }),
        }),
      ).toBe(false);
      // And the stale stamp is still exactly what it was — nothing recorded a
      // success that did not happen.
      expect(readStamp(stampPath)).not.toBe(
        digestGoSources({ watchDirs, watchFiles, root }),
      );
    });

    /** @scenario "A record restored without its binary rebuilds" */
    it("rebuilds when the binary is missing", () => {
      rmSync(binaryPath);

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, watchFiles, root }),
        }),
      ).toBe(false);
    });
  });

  /** @scenario "A binary restored without its provenance rebuilds" */
  it("rebuilds a binary that has no stamp beside it", () => {
    const binaryPath = write(".vitest-tmp/nlpgo-test", "binary");

    expect(
      cachedBinaryIsUsable({
        binaryPath,
        stampPath: `${binaryPath}.stamp`,
        currentDigest: digestGoSources({ watchDirs, watchFiles, root }),
      }),
    ).toBe(false);
  });

  describe("given a digest of the current sources", () => {
    let before: string;

    beforeEach(() => {
      before = digestGoSources({ watchDirs, watchFiles, root });
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when a Go file is added", () => {
      write("services/nlpgo/added.go", "package main\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when a Go file is removed", () => {
      rmSync(path.join(root, "services/nlpgo/inner/util.go"));
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    /** @scenario "A file that changed in name only still rebuilds" */
    it("changes when a Go file is renamed but keeps its bytes", () => {
      rmSync(path.join(root, "services/nlpgo/inner/util.go"));
      write("services/nlpgo/inner/renamed.go", "package inner\n");

      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    /** @scenario "A restored binary is reused when nothing changed" */
    it("is unchanged when a file's mtime moves but its bytes do not", () => {
      const future = new Date(Date.now() + 60_000);
      utimesSync(path.join(root, "services/nlpgo/main.go"), future, future);

      expect(digestGoSources({ watchDirs, watchFiles, root })).toBe(before);
    });

    /** @scenario "Documentation alongside the service does not rebuild it" */
    it("is unchanged when a README appears under a watched tree", () => {
      write("services/nlpgo/README.md", "# notes\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).toBe(before);
    });

    // The module files sit at the repo root, outside every watched tree, and a
    // dependency bump or a `replace` retarget changes what compiles without
    // touching one .go file. Watching only the trees reused a stale binary.
    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when a dependency in the root go.mod changes", () => {
      write("go.mod", "module example.com/x\nrequire example.com/dep v1.2.3\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when the workspace file changes", () => {
      write("go.work", "go 1.24\nuse ./sdks/go\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    // The engine imports the Go SDK, and the root go.mod `replace`s it to
    // ./sdks/go — so it compiles in from the working tree.
    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when the Go SDK changes", () => {
      write("sdks/go/prompts/prompts.go", "package prompts\n// edited\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });

    /** @scenario "A change to anything the service is built from rebuilds it" */
    it("changes when a module file appears that was not there before", () => {
      write("go.sum", "example.com/dep v1.2.3 h1:abc=\n");
      expect(digestGoSources({ watchDirs, watchFiles, root })).not.toBe(before);
    });
  });

  describe("when a watched directory does not exist", () => {
    /** @scenario "A checkout does not on its own force a rebuild" */
    it("digests the trees that do exist rather than throwing", () => {
      const withMissing = [...watchDirs, path.join(root, "does", "not", "exist")];

      expect(digestGoSources({ watchDirs: withMissing, watchFiles, root })).toBe(
        digestGoSources({ watchDirs, watchFiles, root }),
      );
    });
  });
});
