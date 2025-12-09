import * as fs from "fs";
import * as path from "path";
import { CliRunner } from "../cli/helpers/cli-runner";
import { expect } from "vitest";

const TMP_BASE_DIR = path.join(__dirname, "tmp");

export const setupCliRunner = () => {
  fs.mkdirSync(TMP_BASE_DIR, { recursive: true });
  const testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "test-dir-"));
  const originalCwd = process.cwd();
  process.chdir(testDir);
  const cli = new CliRunner({ cwd: testDir });
  return { cli, testDir, originalCwd }
}

export const teardownCliRunner = (params: { testDir: string, originalCwd: string }) => {
  const { testDir, originalCwd } = params;
  process.chdir(originalCwd);
  fs.rmSync(testDir, { recursive: true, force: true });
}

export const createLocalPromptFile = (params: { handle: string, cli: CliRunner, testDir: string }) => {
  const { handle, cli = setupCliRunner().cli, testDir } = params;
  const initResult = cli.run(`prompt init`);
  expect(initResult.success).toBe(true);
  const createResult = cli.run(`prompt create ${handle}`);
  expect(createResult.success).toBe(true);
  const promptFilePath = path.join(testDir, "prompts", `${handle}.prompt.yaml`);
  const addResult = cli.run(`prompt add ${handle} ${promptFilePath}`);
  expect(addResult.success).toBe(true);

  return {
    promptFilePath,
  }
}
