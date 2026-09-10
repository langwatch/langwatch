import process from "node:process";
import { startStandaloneApi } from "./app/api-standalone.executable.ts";

/**
 * Everything the API process does lives in startStandaloneApi, which is the
 * table of what the process is made of.
 *
 * A boot failure has already been written to the error stream by the time this
 * catch runs; what is left to decide here is the exit status, and it is
 * non-zero. Nothing is re-reported: a failure printed twice reads as two
 * failures.
 */
export function bootApi(): Promise<void> {
  return startStandaloneApi().catch(() => {
    process.exitCode = 1;
  });
}
