// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Where the operator-only columns of a run status may be named. A listing outcome records the
 * provider's raw HTTP status for the operator; the customer is shown the outcome and a sentence.
 * That is a claim about files, so the files are what this reads.
 *
 * Spec: specs/ai-governance/dashboard/provider-data-boundaries.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MODULE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const STATUS_COLUMNS = /LastAgentsListingStatus|LastPeopleListingStatus|WithheldCount/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("given a listing outcome recorded with the provider's raw HTTP status", () => {
  /** @scenario "An operator-only HTTP status never reaches a customer" */
  it("names the status columns in no browser or contract file", () => {
    const customerFacing = [
      ...sourceFiles(join(MODULE, "browser/src")),
      ...sourceFiles(join(MODULE, "contract/src")),
    ];

    const naming = customerFacing.filter((file) => STATUS_COLUMNS.test(readFileSync(file, "utf8")));

    expect(naming).toEqual([]);
  });
});
