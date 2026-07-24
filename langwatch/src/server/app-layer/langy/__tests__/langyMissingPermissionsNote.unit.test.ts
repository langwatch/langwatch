import { describe, expect, it } from "vitest";
import { renderLangyMissingPermissionsNote } from "../langy-turn.service";

/**
 * The pre-flight "access you lack" note (spec:
 * specs/langy/langy-api-key-provisioning.feature — Rule "A turn is told the
 * access it lacks so it can decline before attempting").
 */
describe("renderLangyMissingPermissionsNote", () => {
  describe("when the caller is missing some Langy access", () => {
    /** @scenario The turn names the access the caller does not hold */
    it("names each missing access in the customer's words and carries the slug", () => {
      const note = renderLangyMissingPermissionsNote([
        "scenarios:create",
        "evaluations:create",
      ]);

      // Named in plain words the customer already uses…
      expect(note).toContain("create scenarios");
      expect(note).toContain("create online evaluations");
      // …and the raw slug rides along so the model can quote the exact access.
      expect(note).toContain("`scenarios:create`");
      expect(note).toContain("`evaluations:create`");
      // It must tell the assistant to stop, not attempt-and-retry.
      expect(note.toLowerCase()).toContain("do not run");
    });

    it("maps the action verb to the customer's word (update → edit)", () => {
      const note = renderLangyMissingPermissionsNote(["prompts:update"]);
      expect(note).toContain("edit prompts");
      expect(note).toContain("`prompts:update`");
    });
  });

  describe("when the caller holds every access Langy uses", () => {
    /** @scenario A caller who holds everything gets no such note */
    it("returns an empty note so nothing is prepended to the turn", () => {
      expect(renderLangyMissingPermissionsNote([])).toBe("");
    });
  });
});
