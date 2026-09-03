import process from "node:process";
import { startStandaloneApi } from "./app/api-standalone.executable";

/**
 * The runnable API process — `pnpm --filter @langwatch/platform-api start`.
 *
 * Everything it does lives in startStandaloneApi, which is the table of what
 * the process is made of. This module exists only so the start command has one
 * file to execute, and so the executable itself stays importable without
 * booting.
 *
 * A boot failure has already been written to the error stream by the time this
 * catch runs; what is left to decide here is the exit status, and it is
 * non-zero. Nothing is re-reported: a failure printed twice reads as two
 * failures.
 */
void startStandaloneApi().catch(() => {
  process.exitCode = 1;
});
