// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/pullers/__tests__/pullerWorkerErasureSuppression.unit.test.ts
import { describe, it } from "vitest";

describe("given a pull carrying an event that names an erased person", () => {
  describe("when the run reaches the customer's trace project", () => {
    /** @scenario "An erased person's conversations stop being exported" */
    it.todo("exports nothing, rather than republishing the conversation");
  });
  describe("when the batch also carries somebody who was not erased", () => {
    /** @scenario "Suppression removes only the erased person from the export" */
    it.todo("exports the other conversation and leaves the erased address out of it");
    /** @scenario "An erased identifier is never re-discovered" */
    it.todo("discovers the other person and never the erased identifier");
  });
  describe("when the event is a directory listing of the erased person", () => {
    /** @scenario "An erased identifier in the directory is skipped entirely" */
    it.todo("neither discovers them nor lets their department row through");
  });
});
describe("given a pull where person discovery itself breaks", () => {
  /** @scenario "Discovery failing does not cost the run its events" */
  it.todo("still writes the audit row and exports the conversation");
});
describe("given a pull where nobody has been erased", () => {
  describe("when the run reaches the customer's trace project", () => {
    it.todo("exports the conversation exactly as it did before erasure existed");
  });
});
