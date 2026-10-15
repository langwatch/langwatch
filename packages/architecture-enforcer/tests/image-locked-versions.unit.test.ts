import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, "../../../infra/docker/check-locked-versions.mjs");

const lockfile = (packages: string[]) =>
  [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      zod:",
    "        specifier: ^3.23.0",
    "        version: 3.23.8",
    "",
    "packages:",
    "",
    ...packages.flatMap((key) => [`  ${key}:`, "    resolution: {integrity: sha512-x}", ""]),
    "snapshots:",
    "",
    "  zod@3.23.8: {}",
    "",
  ].join("\n");

describe("given the image re-resolves the committed lockfile", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "image-locked-versions-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const check = ({ committed, resolved }: { committed: string[]; resolved: string[] }) => {
    writeFileSync(path.join(dir, "committed.yaml"), lockfile(committed));
    writeFileSync(path.join(dir, "resolved.yaml"), lockfile(resolved));
    return spawnSync(
      process.execPath,
      [CHECK, path.join(dir, "committed.yaml"), path.join(dir, "resolved.yaml")],
      { encoding: "utf8" },
    );
  };
  const committed = ["zod@3.23.8", "'@scope/tool@1.0.0'", "vitest@5.0.1"];

  describe("when the re-resolve only drops a dev-tool package", () => {
    /** @scenario "The image's production install keeps the committed package versions" */
    it("passes", () => {
      const result = check({ committed, resolved: ["zod@3.23.8", "'@scope/tool@1.0.0'"] });

      expect(result.status, result.stderr).toBe(0);
    });
  });

  describe("when the re-resolve names a version the committed lockfile does not", () => {
    /** @scenario "The image's production install keeps the committed package versions" */
    it("fails and names that version", () => {
      const result = check({ committed, resolved: ["zod@3.24.0", "'@scope/tool@1.0.0'"] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not in the committed lockfile: zod@3.24.0");
      expect(result.stderr).not.toContain("@scope/tool");
    });
  });
});
