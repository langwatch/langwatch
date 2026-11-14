import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Task } from "@langwatch/task";

import {
  serializeVectors,
  VECTORS_RELATIVE_PATH,
} from "../rules/webhook-signature-vectors.rules.ts";

/** Rewrites committed cross-language webhook signature vectors. Needs no
 * infrastructure, so it's the launcher's smoke test. */
export class WebhookSignatureVectorsTask extends Task {
  readonly name = "webhook-signature-vectors";
  readonly description = "Rewrites the committed cross-language webhook signature vectors.";

  private constructor(private readonly target: string) {
    super();
  }

  /** `target` defaults to the committed vectors file; tests point it elsewhere. */
  static create({ target }: { target?: string } = {}): WebhookSignatureVectorsTask {
    return new WebhookSignatureVectorsTask(
      target ?? resolve(import.meta.dirname, "../../../../..", VECTORS_RELATIVE_PATH),
    );
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const target = this.target;
    mkdirSync(dirname(target), { recursive: true });
    // Written beside the target and renamed over it, so a concurrent reader (the vectors drift
    // test runs in the same suite) sees the old file or the new one, never a truncated one.
    const staged = `${target}.${process.pid}.tmp`;
    try {
      writeFileSync(staged, serializeVectors());
      renameSync(staged, target);
    } finally {
      rmSync(staged, { force: true });
    }
    process.stdout.write(`wrote ${target}\n`);
  }
}
