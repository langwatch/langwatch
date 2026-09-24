// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; the rest of main's file is
// bound in ingestion-pull-worker.service.unit.test.ts.
import { describe, it } from "vitest";

describe("given a pull carrying an event that names an erased person", () => {
  describe("when the event is a directory listing of the erased person", () => {
    /** @scenario "An erased identifier in the directory is skipped entirely" */
    it.todo("neither discovers them nor lets their department row through");
  });
});
