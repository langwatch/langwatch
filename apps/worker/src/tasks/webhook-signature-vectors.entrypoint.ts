import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { serializeVectors, VECTORS_RELATIVE_PATH } from "@langwatch/egress";

/**
 * Rewrites the committed cross-language webhook signature vectors —
 * `pnpm --filter @langwatch/worker task:webhook-signature-vectors`.
 *
 * The vectors themselves are built in `@langwatch/egress`, beside the signing
 * code they come from, and a unit test there fails when this file's output
 * stops matching what is committed. This entrypoint is only the write: it
 * lives in the process that owns webhook delivery so the generator is a thin
 * runner over the package's own service rather than a standalone tool with a
 * second copy of the algorithm in it.
 */
const target = resolve(import.meta.dirname, "../../../..", VECTORS_RELATIVE_PATH);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, serializeVectors());
process.stdout.write(`wrote ${target}\n`);
