import process from "node:process";
import { startStandaloneApi } from "./app/api-standalone.executable";

/**
 * The runnable API process. Everything it does lives in startStandaloneApi;
 * this module exists only so `pnpm start` has one file to execute, and so the
 * executable itself stays importable without booting.
 */
void startStandaloneApi().catch(() => {
  process.exitCode = 1;
});
