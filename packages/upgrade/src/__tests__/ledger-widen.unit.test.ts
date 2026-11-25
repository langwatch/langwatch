/**
 * @see specs/setup/upgrade-ledger.feature
 */
import { describe, expect, it, vi } from "vitest";

import { UpgradeLedgerRepository } from "../ledger.repository.ts";

describe("registering declared steps", () => {
  /** @scenario "A step declared without a description is refused" */
  it("refuses a step with an empty description before anything is written", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const ledger = UpgradeLedgerRepository.create({ postgres: { query } });

    await expect(
      ledger.registerDeclaredSteps({
        steps: [
          { id: "trace:fold", kind: "data", mode: "background", owner: "trace", description: "" },
        ],
      }),
    ).rejects.toThrow(/description/);

    expect(query).not.toHaveBeenCalled();
  });
});
