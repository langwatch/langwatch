import { expect } from "vitest";
import { type CliResult } from "./cli-runner";

export function expectCliResultSuccess(result: CliResult) {
  try {
    expect(result.success).toBe(true);
  } catch (error) {
    console.error(result.output);
    throw error;
  }
}
