/**
 * langy-worker entry point.
 *
 * boot.js MUST stay the first import: ESM evaluates imported modules in
 * declaration order, so its stdout guard runs before the pi SDK (imported
 * transitively through app.js) can execute any side effect.
 */

import { rawStdoutWrite } from "./boot.js";
import packageJson from "../package.json" with { type: "json" };
import { runApp } from "./app.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    rawStdoutWrite(`${packageJson.version}\n`, () => {
      process.exit(0);
    });
    return;
  }

  process.on("uncaughtException", (error) => {
    process.stderr.write(
      `langy-worker: uncaught exception: ${error.stack ?? error.message}\n`,
    );
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `langy-worker: unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
    );
    process.exit(1);
  });

  await runApp();
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `langy-worker: fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
