/**
 * Writes, or with `--check` verifies, the image's code step list as `pnpm task upgrade steps`
 * lists it. Run from the root: `node --experimental-transform-types <this file> [--check]`.
 * Spec: packages/upgrade/specs/image-code-steps.feature.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { TASKS_APP_DIRECTORY } from "../src/gate/first-install-upgrade.ts";
import {
  IMAGE_CODE_STEPS_COMMAND,
  IMAGE_CODE_STEPS_FILE,
  imageCodeStepsDrift,
  parseImageCodeSteps,
  readImageCodeSteps,
} from "../src/gate/image-code-steps.ts";

const { values: options } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const scratch = mkdtempSync(join(tmpdir(), "image-code-steps-"));
try {
  const listed = join(scratch, "code-steps.json");
  const run = spawnSync("pnpm", ["task", "upgrade", "steps", "--json", "--out", listed], {
    cwd: TASKS_APP_DIRECTORY,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (run.status !== 0) {
    throw new Error(`pnpm task upgrade steps exited ${run.status ?? run.signal}`);
  }
  const text = readFileSync(listed, "utf8");
  const collected = parseImageCodeSteps({ name: "pnpm task upgrade steps", text });
  if (options.check) {
    const drift = imageCodeStepsDrift({ committed: readImageCodeSteps(), collected });
    if (drift.length > 0) {
      process.stderr.write(
        `${IMAGE_CODE_STEPS_FILE} is stale:\n${drift.map((line) => `  ${line}\n`).join("")}` +
          `Run \`${IMAGE_CODE_STEPS_COMMAND}\` and commit the file.\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`${collected.length} code steps: the list is fresh\n`);
    }
  } else {
    writeFileSync(IMAGE_CODE_STEPS_FILE, text);
    process.stdout.write(`${collected.length} code steps -> ${IMAGE_CODE_STEPS_FILE}\n`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
