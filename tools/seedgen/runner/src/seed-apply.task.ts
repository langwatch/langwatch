import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";

import { Task } from "@langwatch/task";

import { seedActionSchema, type SeedReply, unresolvedRefOf } from "./protocol.ts";
import { applySeedAction, type SeedApis } from "./seed-kinds.ts";

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 64;

function concurrencyOf(args: readonly string[]): number {
  const { values } = parseArgs({ args: [...args], options: { concurrency: { type: "string" } } });
  const concurrency = Number(values.concurrency ?? DEFAULT_CONCURRENCY);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`seed:apply --concurrency takes a whole number from 1 to ${MAX_CONCURRENCY}`);
  }
  return concurrency;
}

/**
 * `pnpm task seed:apply`: reads seedgen's NDJSON actions on stdin, applies at most
 * `--concurrency` at once through installed module Apis and writes one reply line per action.
 * Protocol: dev/docs/plans/seed-2026-10-09.md §2.
 */
export class SeedApplyTask extends Task {
  readonly name = "seed:apply";
  readonly description =
    "Applies seedgen actions (NDJSON on stdin) through installed module Apis; replies on stdout.";
  readonly #apis: SeedApis;
  readonly #input: Readable;
  readonly #output: Writable;

  constructor({ apis, input, output }: { apis: SeedApis; input: Readable; output: Writable }) {
    super();
    this.#apis = apis;
    this.#input = input;
    this.#output = output;
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const concurrency = concurrencyOf(args);
    const inFlight = new Set<Promise<void>>();
    let failure: unknown;
    const reply = (line: SeedReply): void => {
      this.#output.write(`${JSON.stringify(line)}\n`);
    };
    let lineNumber = 0;
    for await (const line of createInterface({ input: this.#input, crlfDelay: Infinity })) {
      lineNumber += 1;
      if (line.trim() === "") continue;
      signal.throwIfAborted();
      if (failure) throw failure;
      const action = seedActionSchema.safeParse(JSON.parse(line));
      if (!action.success) {
        throw new Error(
          `seed:apply line ${lineNumber} is not a seed action: ${action.error.message}`,
        );
      }
      const unresolved = unresolvedRefOf(action.data);
      if (unresolved) {
        throw new Error(`seed:apply line ${lineNumber} has an unresolved $ref in "${unresolved}"`);
      }
      while (inFlight.size >= concurrency) await Promise.race(inFlight);
      const applying = applySeedAction({ action: action.data, apis: this.#apis })
        .then(reply)
        .catch((error: unknown) => {
          failure ??= error;
        })
        .finally(() => inFlight.delete(applying));
      inFlight.add(applying);
    }
    await Promise.all(inFlight);
    if (failure) throw failure;
  }
}
