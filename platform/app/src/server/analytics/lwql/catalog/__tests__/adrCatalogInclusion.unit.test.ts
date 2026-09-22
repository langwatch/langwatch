/**
 * The opt-in flip (ADR-142) is a decision, not just code: this pins that the ADR
 * exists, is discoverable from the ADR index, and actually records the opt-in
 * choice — so the code change cannot land without its rationale.
 *
 * @see ../../../../../../../dev/docs/adr/142-lwql-catalog-inclusion-is-opt-in.md
 * @see specs/lwql/catalog-inclusion.feature
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADR_DIR = join(process.cwd(), "../../dev/docs/adr");
const ADR_FILE = "142-lwql-catalog-inclusion-is-opt-in.md";

describe("given the LangWatchQL catalog-inclusion ADR", () => {
  /** @scenario "An ADR records the opt-out to opt-in flip" */
  it("exists, is listed in the ADR index, and records the opt-in decision", () => {
    const adr = readFileSync(join(ADR_DIR, ADR_FILE), "utf-8");
    expect(adr).toContain("# ADR-142:");
    expect(adr).toContain("opt-in");
    expect(adr).toContain("opt-out");

    const index = readFileSync(join(ADR_DIR, "README.md"), "utf-8");
    expect(index).toContain(`(./${ADR_FILE})`);
  });
});
