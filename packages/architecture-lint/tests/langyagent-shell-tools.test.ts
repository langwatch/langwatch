/**
 * The shell tools the worker box has to carry.
 *
 * The agent works through a shell and calls these by name. A production
 * session read a 40 row result and then lost three commands in a row trying to
 * narrow it: the CLI's `--jq` outside its supported subset, then `jq`, then
 * `python`. Only `python3` was installed, under a name the agent did not try.
 *
 * @see specs/langy/langy-worker-shell-tools.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// packages/architecture-lint/tests/ -> ../../.. = repo root
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "../../..");
const DOCKERFILE = readFileSync(
  path.join(REPO_ROOT, "infra/docker/Dockerfile.langyagent"),
  "utf-8",
);

/**
 * The one `apt-get install` of the runtime stage, as a list of package names.
 *
 * Read from the runtime stage alone: the builder stages install their own
 * toolchains, and a package present only there never reaches a worker.
 */
const runtimePackages = (): string[] => {
  const runtimeStage = DOCKERFILE.slice(DOCKERFILE.indexOf("FROM debian:bookworm-slim"));
  const install = /apt-get install -y --no-install-recommends([^&]*)/.exec(runtimeStage);
  return (install?.[1] ?? "").replaceAll("\\\n", " ").split(/\s+/).filter(Boolean);
};

describe("given the langyagent runtime image", () => {
  const packages = runtimePackages();

  it("reads a package list at all, so a rewrite cannot make this guard vacuous", () => {
    expect(packages).toContain("curl");
    expect(packages.length).toBeGreaterThan(3);
  });

  describe("when the agent narrows a saved JSON answer", () => {
    /** @scenario "The worker image carries jq" */
    it("carries jq", () => {
      expect(packages).toContain("jq");
    });

    /** @scenario "The bare name python runs the interpreter" */
    it("answers to the name python as well as python3", () => {
      expect(packages).toContain("python3");
      expect(packages).toContain("python-is-python3");
    });
  });
});
