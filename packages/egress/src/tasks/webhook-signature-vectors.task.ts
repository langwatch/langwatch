import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Task } from "@langwatch/task";
import { serializeVectors, VECTORS_RELATIVE_PATH } from "../webhook/signature-vectors";

/**
 * Rewrites the committed cross-language webhook signature vectors —
 * `pnpm --filter @langwatch/tasks task webhook-signature-vectors`.
 *
 * The vectors themselves are built in this package, beside the signing code
 * they come from, and a unit test here fails when this task's output stops
 * matching what is committed. This task is only the write: it lives beside
 * webhook delivery so the write is a thin runner over the package's own
 * generator rather than a standalone tool with a second copy of the
 * algorithm in it. It needs no infrastructure — no `TaskHostPort` handle —
 * so it is the task the launcher's smoke test runs.
 */
export class WebhookSignatureVectorsTask extends Task {
  readonly name = "webhook-signature-vectors";
  readonly description = "Rewrites the committed cross-language webhook signature vectors.";

  static create(): WebhookSignatureVectorsTask {
    return new WebhookSignatureVectorsTask();
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const target = resolve(import.meta.dirname, "../../../..", VECTORS_RELATIVE_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serializeVectors());
    process.stdout.write(`wrote ${target}\n`);
  }
}
