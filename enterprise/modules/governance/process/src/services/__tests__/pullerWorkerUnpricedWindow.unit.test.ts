// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/pullers/__tests__/pullerWorkerUnpricedWindow.unit.test.ts
import { describe, it } from "vitest";

describe("the window a pull read but was not allowed to price", () => {
  describe("given this organization is not recording pulled cost", () => {
    /** @scenario "A day read without recording cost is remembered as unpriced" */
    it.todo("records the day whose spend it dropped, so the day is not read as free");
    /** @scenario "The unpriced window spans the first lost day to the last" */
    it.todo("spans the window from the first dropped day to the last");
    /** @scenario "A later loss never shrinks an earlier one" */
    it.todo("keeps the earlier loss when a later run drops a later day");
    /** @scenario "A day that never carried a price is not remembered as lost" */
    it.todo("claims no loss for a day that never carried a price");
  });
  describe("given this organization is recording pulled cost", () => {
    /** @scenario "Recording cost normally remembers no loss" */
    it.todo("records no window, because nothing was dropped");
    /** @scenario "Reading back across the whole window clears it" */
    it.todo("forgets the window once a re-read reaches back across all of it");
    /** @scenario "A re-read that starts inside the window leaves it alone" */
    it.todo("keeps the window when the re-read starts inside it, because half a repair is not one");
    /** @scenario "A cost read that stopped before its end leaves the window alone" */
    it.todo("keeps the window when the read that reached back was cut short");
  });
});
