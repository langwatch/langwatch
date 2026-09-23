import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Task } from "@langwatch/task";

import { serializeVectors, VECTORS_RELATIVE_PATH } from "../webhook/signature-vectors.ts";

/** Rewrites committed cross-language webhook signature vectors. Needs no
 * infrastructure, so it's the launcher's smoke test. */
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
