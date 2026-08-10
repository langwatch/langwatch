import { describe, expect, it } from "vitest";

import { drawers } from "../drawerRegistry";

describe("drawerRegistry", () => {
  describe("given a link that names the superseded automation drawer", () => {
    describe("when the registry resolves it", () => {
      /** @scenario "A link issued before the drawer changed still opens the automation" */
      it("resolves the old name to the authoring drawer", () => {
        // The REST `platformUrl` field and the automation emails handed out
        // `drawer.open=editAutomationFilter` for as long as that drawer was the
        // one they opened. Those links live in inboxes and in whatever callers
        // stored the response, so the name has to keep resolving, and it has to
        // resolve to the drawer that can edit a query condition.
        expect(drawers.editAutomationFilter).toBe(drawers.automation);
      });
    });
  });
});
