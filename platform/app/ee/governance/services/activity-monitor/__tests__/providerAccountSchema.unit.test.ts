// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a connection is allowed to keep about the account it reads.
 *
 * The duplicate-connection guard compares the account the provider itself
 * reports, and that is the whole of what is stored. Nothing derived from a
 * customer's administrator key is persisted — no hash, no digest, no
 * fingerprint — because a stored scramble of a live credential is a promise
 * about a secret we would then have to keep, and the account id is not a secret
 * and cannot be turned back into a key.
 *
 * That claim is about the schema, so the schema is what this reads. A test that
 * only inspects a write payload cannot see a column, and "we agreed not to add
 * one" is not enforcement. Scoped to the one model on purpose: this is the
 * connection-identity contract, not a repo-wide naming cop.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlements 6 and 7; 00i doubts 8 and 9.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCHEMA = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../prisma/schema.prisma",
);

/** Every scalar field of one model, as `name` → `type`. */
function modelFields(model: string): Record<string, string> {
  const source = readFileSync(SCHEMA, "utf8");
  const block = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, "m").exec(
    source,
  );
  if (!block) throw new Error(`model ${model} not found in ${SCHEMA}`);
  const fields: Record<string, string> = {};
  for (const line of block[1]!.split("\n")) {
    const trimmed = line.trim();
    // Block attributes (`@@index`), doc comments and blanks are not fields.
    if (!trimmed || trimmed.startsWith("@@") || trimmed.startsWith("//")) {
      continue;
    }
    const field = /^(\w+)\s+(\S+)/.exec(trimmed);
    if (field) fields[field[1]!] = field[2]!;
  }
  return fields;
}

describe("given the connection row that holds which account a connection reads", () => {
  describe("when its columns are read", () => {
    /** @scenario "The refusal never shows any part of the stored key" */
    it("keeps nothing worked out from an administrator key", () => {
      // `ingestSecretHash` is the INBOUND ingest secret an upstream operator
      // pastes into their own exporter — ours, rotatable, and nothing to do
      // with a customer's provider credential. It is the only member of this
      // set, and a second one arriving is the change this test exists to
      // catch.
      const keyish = Object.keys(modelFields("IngestionSource")).filter(
        (name) => /hash|digest|fingerprint|secret|key/i.test(name),
      );

      expect(keyish).toEqual(["ingestSecretHash"]);
    });

    /** @scenario "A second connection reading the same report from an account already connected is refused" */
    it("holds the provider-reported account, and holds it optionally", () => {
      // Nullable because every connection that predates the guard has no
      // account recorded, and a required column would fail the migration on
      // the first customer with a source. "Unknown account" has to be a
      // storable state.
      const fields = modelFields("IngestionSource");

      expect(fields.providerAccountId).toBe("String?");
    });
  });
});
