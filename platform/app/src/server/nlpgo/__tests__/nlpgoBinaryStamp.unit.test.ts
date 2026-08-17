import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
    ];
    write("services/nlpgo/main.go", "package main\n");
    write("services/nlpgo/inner/util.go", "package inner\n");
    write("cmd/service/main.go", "package main\n");
    write("go.mod", "module example.com/x\n");
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
      writeStamp(stampPath, digestGoSources({ watchDirs, root }));
    });

    /** @scenario "A cache restore whose sources were rewritten by checkout is reused" */
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
          currentDigest: digestGoSources({ watchDirs, root }),
        }),
      ).toBe(true);
    });

    /** @scenario "A changed Go source rebuilds" */
    it("rebuilds when a Go source changed", () => {
      write("services/nlpgo/main.go", "package main\n// edited\n");

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, root }),
        }),
      ).toBe(false);
    });

    /** @scenario "A changed Go source rebuilds" */
    it("records the current digest when the stamp is rewritten", () => {
      write("services/nlpgo/main.go", "package main\n// edited\n");
      const rebuilt = digestGoSources({ watchDirs, root });
      writeStamp(stampPath, rebuilt);

      expect(readStamp(stampPath)).toBe(rebuilt);
      expect(
        cachedBinaryIsUsable({ binaryPath, stampPath, currentDigest: rebuilt }),
      ).toBe(true);
    });

    /** @scenario "A stamp with no binary rebuilds" */
    it("rebuilds when the binary is missing", () => {
      rmSync(binaryPath);

      expect(
        cachedBinaryIsUsable({
          binaryPath,
          stampPath,
          currentDigest: digestGoSources({ watchDirs, root }),
        }),
      ).toBe(false);
    });
  });

  /** @scenario "A binary with no stamp rebuilds" */
  it("rebuilds a binary that has no stamp beside it", () => {
    const binaryPath = write(".vitest-tmp/nlpgo-test", "binary");

    expect(
      cachedBinaryIsUsable({
        binaryPath,
        stampPath: `${binaryPath}.stamp`,
        currentDigest: digestGoSources({ watchDirs, root }),
      }),
    ).toBe(false);
  });

  describe("given a digest of the current sources", () => {
    let before: string;

    beforeEach(() => {
      before = digestGoSources({ watchDirs, root });
    });

    /** @scenario "A file added to a watched tree changes the digest" */
    it("changes when a Go file is added", () => {
      write("services/nlpgo/added.go", "package main\n");
      expect(digestGoSources({ watchDirs, root })).not.toBe(before);
    });

    /** @scenario "A file removed from a watched tree changes the digest" */
    it("changes when a Go file is removed", () => {
      rmSync(path.join(root, "services/nlpgo/inner/util.go"));
      expect(digestGoSources({ watchDirs, root })).not.toBe(before);
    });

    /** @scenario "Renaming a file changes the digest even when the content is unchanged" */
    it("changes when a Go file is renamed but keeps its bytes", () => {
      rmSync(path.join(root, "services/nlpgo/inner/util.go"));
      write("services/nlpgo/inner/renamed.go", "package inner\n");

      expect(digestGoSources({ watchDirs, root })).not.toBe(before);
    });

    /** @scenario "Touching a file without editing it leaves the digest alone" */
    it("is unchanged when a file's mtime moves but its bytes do not", () => {
      const future = new Date(Date.now() + 60_000);
      utimesSync(path.join(root, "services/nlpgo/main.go"), future, future);

      expect(digestGoSources({ watchDirs, root })).toBe(before);
    });

    /** @scenario "A non-Go file is ignored" */
    it("is unchanged when a README appears under a watched tree", () => {
      write("services/nlpgo/README.md", "# notes\n");
      expect(digestGoSources({ watchDirs, root })).toBe(before);
    });
  });

  describe("when a watched directory does not exist", () => {
    /** @scenario "A cache restore whose sources were rewritten by checkout is reused" */
    it("digests the trees that do exist rather than throwing", () => {
      const withMissing = [
        ...watchDirs,
        path.join(root, "does", "not", "exist"),
      ];

      expect(digestGoSources({ watchDirs: withMissing, root })).toBe(
        digestGoSources({ watchDirs, root }),
      );
    });
  });
});
