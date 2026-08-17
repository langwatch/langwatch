import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
import { deriveShape, describeShapeDiff, diffShape, type ShapeSpec } from "./shape";

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const RECORDING = process.env.E2E_RECORD_CONTRACTS === "1";

/**
 * Asserts a live response still matches its checked-in contract.
 *
 * Golden files live in `tests/contracts/<name>.json` and are committed. To
 * author or update one, run with `E2E_RECORD_CONTRACTS=1` and read the diff in
 * the resulting file before committing it — recording is a way to draft the
 * contract, never a way to make a failure go away.
 */
export function expectMatchesContract(name: string, actual: unknown): void {
  const file = path.join(CONTRACTS_DIR, `${name}.json`);

  if (RECORDING) {
    fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(deriveShape(actual), null, 2)}\n`);
    console.log(`recorded contract: ${path.relative(process.cwd(), file)}`);
    return;
  }

  if (!fs.existsSync(file)) {
    throw new Error(
      `No contract recorded for "${name}".\n` +
        `Run once with E2E_RECORD_CONTRACTS=1 to draft ${path.relative(process.cwd(), file)}, ` +
        `then review it before committing.`,
    );
  }

  const expected = JSON.parse(fs.readFileSync(file, "utf8")) as ShapeSpec;
  const message = describeShapeDiff(name, diffShape(actual, expected));

  expect(message, message ?? undefined).toBeNull();
}
