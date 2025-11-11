import { describe, it } from "vitest";

describe("SyncedChatInput", () => {
  describe("handleSend", () => {
    describe("when synced", () => {
      it.todo("broadcasts message to all synced chats via triggerSubmit");
    });

    describe("when not synced", () => {
      it.todo("sends message locally and clears input on success");
      it.todo("restores input on error");
    });
  });

  describe("handleKeyDown", () => {
    it.todo("submits on Enter key without shift");
    it.todo("submits on Enter key with ctrl");
    it.todo("does not submit on Enter with shift (allows new line)");
  });

  describe("submit trigger useEffect", () => {
    it.todo("skips when not synced");
    it.todo("skips when no submitTrigger");
    it.todo("skips when timestamp already processed");
    it.todo("skips when tab is not active");
    it.todo("submits when all conditions met");
  });
});

