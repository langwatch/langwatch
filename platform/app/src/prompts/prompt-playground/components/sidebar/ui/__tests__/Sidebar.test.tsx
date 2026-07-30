import { describe, it } from "vitest";

describe("Sidebar", () => {
  describe("SidebarList", () => {
    describe("when title is not provided", () => {
      it.todo("renders children without header");
    });

    describe("when collapsible logic", () => {
      it.todo("renders children when not collapsible");
      it.todo("renders children when collapsible and isOpen is true");
      it.todo("hides children when collapsible and isOpen is false");
    });
  });
});
