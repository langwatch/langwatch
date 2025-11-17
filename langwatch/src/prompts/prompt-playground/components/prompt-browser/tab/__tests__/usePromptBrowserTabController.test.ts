import { describe, it } from "vitest";

describe("usePromptBrowserTabController", () => {
  describe("handleClose", () => {
    describe("when hasUnsavedChanges or isNewPrompt", () => {
      it.todo("shows confirmation dialog when hasUnsavedChanges is true");
      it.todo("shows confirmation dialog when isNewPrompt is true");
      it.todo("removes tab when user confirms");
      it.todo("does not remove tab when user cancels");
    });

    describe("when no unsaved changes", () => {
      it.todo("removes tab immediately without confirmation");
    });
  });
});

