import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "../keys.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPTS = join(REPOSITORY_ROOT, "dev/scripts");

/**
 * `.env` has three writers of a credential, and each one is here on purpose:
 * two generate a value that never existed, and the third replaces the three
 * rotating AWS SSO lines the launcher hard-fails without. A fourth is a bug.
 */
const ALLOWED_WRITERS = [
  "ensure-ai-gateway-secrets.sh",
  "ensure-langy-dev-env.sh",
  "refresh-dev-s3-env.sh",
];

function scriptNames(): string[] {
  return readdirSync(SCRIPTS, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/** Writing into the `.env` at the workspace root, either helper or redirect. */
const WRITES_ENV_FILE = /env_file_set_key|>>?\s*"?\$ENV_FILE/;

function secretKeysWrittenBy(name: string): string[] {
  const source = readFileSync(join(SCRIPTS, name), "utf8");
  if (!WRITES_ENV_FILE.test(source)) return [];

  return SECRET_KEYS.filter((key) => source.includes(key));
}

describe("given every script under dev/scripts", () => {
  describe("when the writes into .env are read", () => {
    /** @scenario "Only the two generate scripts write a secret key" */
    it("finds a secret key only in the three named writers", () => {
      const writers = scriptNames().filter((name) => secretKeysWrittenBy(name).length > 0);

      expect(writers.sort()).toEqual([...ALLOWED_WRITERS].sort());
    });
  });

  describe("when the generate scripts are read", () => {
    it("finds each one writing only the keys the registry marks generate", () => {
      expect(secretKeysWrittenBy("ensure-ai-gateway-secrets.sh").sort()).toEqual([
        "LW_GATEWAY_INTERNAL_SECRET",
        "LW_GATEWAY_JWT_SECRET",
        "LW_VIRTUAL_KEY_PEPPER",
      ]);
      expect(secretKeysWrittenBy("ensure-langy-dev-env.sh")).toEqual(["LANGY_INTERNAL_SECRET"]);
      expect(secretKeysWrittenBy("refresh-dev-s3-env.sh").sort()).toEqual([
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_SESSION_TOKEN",
      ]);
    });
  });
});
