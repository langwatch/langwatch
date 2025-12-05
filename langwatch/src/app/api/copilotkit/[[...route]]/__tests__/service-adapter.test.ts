import { describe, it } from "vitest";

describe("PromptStudioAdapter", () => {
  describe("process", () => {
    describe("when preparing workflow fails", () => {
      it.todo("returns fallback threadId");
      it.todo("streams error message with ❌ prefix to client");
    });

    describe("when workflow executes successfully", () => {
      describe("when component_state_change event received", () => {
        describe("when stream not started", () => {
          it.todo("starts text message stream");
        });

        describe("when output has new content", () => {
          it.todo("sends incremental delta to stream");
        });

        describe("when state status is success", () => {
          it.todo("finishes message stream");
        });

        describe("when state has error", () => {
          it.todo("sends error message with ❌ prefix to client");
        });
      });

      describe("when error event received", () => {
        it.todo("sends error message with ❌ prefix to client");
      });

      describe("when done event received", () => {
        it.todo("finishes message stream");
      });

      describe("when execution throws unexpected error", () => {
        it.todo("sends error message with ❌ prefix to client");
      });
    });
  });

  describe("finishIfNeeded", () => {
    describe("when stream started and not ended", () => {
      it.todo("sends text message end event");
      it.todo("sets ended flag to true");
    });

    describe("when stream not started", () => {
      it.todo("does not send text message end event");
    });

    describe("when stream already ended", () => {
      it.todo("does not send text message end event again");
    });
  });

  describe("sendError", () => {
    describe("when stream not started", () => {
      it.todo("starts text message stream");
      it.todo("sends error content with ❌ prefix");
    });

    describe("when stream already started", () => {
      it.todo("sends error content with ❌ prefix without starting stream");
    });
  });
});
