import { createLogger } from "@langwatch/observability";

import { sweepProjectApiKeys } from "../server/api-key/project-api-key";
import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:hashProjectApiKeys");

/**
 * Runs the project API key sweep once, on demand.
 *
 * The workers already run it every hour. This task is for an operator who
 * wants it done now, or who wants the plaintext gone without waiting out the
 * grace window:
 *
 *   pnpm task hashProjectApiKeys                     # hash; clear past the grace window
 *   pnpm task hashProjectApiKeys --clear-plaintext   # hash and clear every plaintext now
 *
 * Use `--clear-plaintext` only once no instance of a release older than this
 * one is serving traffic, and with no plan to roll back to one: those
 * releases authenticate project API keys by plaintext only.
 */
export default async function hashProjectApiKeys(
  ...args: string[]
): Promise<void> {
  const clearNow = args.includes("--clear-plaintext");

  // A cleared row is written in the pass after the one that hashed it, so a
  // forced clear needs a second pass.
  const first = await sweepProjectApiKeys({
    prisma,
    ...(clearNow ? { graceMs: 0 } : {}),
  });
  const second = clearNow
    ? await sweepProjectApiKeys({ prisma, graceMs: 0 })
    : { hashed: 0, cleared: 0 };

  logger.info(
    {
      hashed: first.hashed + second.hashed,
      cleared: first.cleared + second.cleared,
    },
    "project API key sweep finished",
  );
}
