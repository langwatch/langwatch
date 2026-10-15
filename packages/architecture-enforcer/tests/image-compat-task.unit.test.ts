import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK_SCRIPT = path.join(HERE, "../../../infra/docker/compat/platform-app/task.mjs");

/** The image layout (/app/platform/app) with a stand-in pnpm that prints what it was given. */
const imageLayout = (root: string) => {
  mkdirSync(path.join(root, "platform/app"), { recursive: true });
  mkdirSync(path.join(root, "apps/tasks"), { recursive: true });
  mkdirSync(path.join(root, "bin"));
  copyFileSync(TASK_SCRIPT, path.join(root, "platform/app/task.mjs"));
  const pnpm = path.join(root, "bin/pnpm");
  writeFileSync(
    pnpm,
    '#!/bin/sh\necho "cwd=$(pwd -P)"\necho "args=$*"\necho "out=${LWQL_RENDER_OUT_DIR:-unset}"\n',
  );
  chmodSync(pnpm, 0o755);
};

const runOldTask = ({ root, args }: { root: string; args: string[] }) =>
  spawnSync(process.execPath, [path.join(root, "platform/app/task.mjs"), ...args], {
    cwd: path.join(root, "platform/app"),
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}` },
  });

describe("given the image's compat task script at the previous release's path", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "image-compat-task-"));
    imageLayout(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("when the old chart runs renderLwqlAccessConfig --out /render", () => {
    /** @scenario "An old Helm chart's LangWatchQL render task still runs from the previous path" */
    it("runs lwql-render-access-config from apps/tasks with the folder in LWQL_RENDER_OUT_DIR", () => {
      const result = runOldTask({ root, args: ["renderLwqlAccessConfig", "--out", "/render"] });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`cwd=${path.join(realpathSync(root), "apps/tasks")}\n`);
      expect(result.stdout).toContain("args=--silent task lwql-render-access-config\n");
      expect(result.stdout).toContain("out=/render");
    });
  });

  describe("when the old chart writes the flag as --out=/render", () => {
    /** @scenario "An old Helm chart's LangWatchQL render task still runs from the previous path" */
    it("passes the folder the same way", () => {
      const result = runOldTask({ root, args: ["renderLwqlAccessConfig", "--out=/render"] });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("args=--silent task lwql-render-access-config\n");
      expect(result.stdout).toContain("out=/render");
    });
  });

  describe("when --out is missing or has no folder after it", () => {
    /** @scenario "An old Helm chart's LangWatchQL render task still runs from the previous path" */
    it("exits 2, names the flag and runs nothing", () => {
      const cases = [[], ["--out"], ["--out", "--force"], ["--out="], ["--out=-x"]];
      for (const flags of cases) {
        const result = runOldTask({ root, args: ["renderLwqlAccessConfig", ...flags] });

        expect(result.status, flags.join(" ")).toBe(2);
        expect(result.stderr).toContain("--out <dir>");
        expect(result.stdout).toBe("");
      }
    });
  });
});
