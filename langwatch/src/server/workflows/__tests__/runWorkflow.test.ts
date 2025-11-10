import { describe, it } from "vitest";

describe("runWorkflow", () => {
  describe("do_not_trace parameter", () => {
    describe("when do_not_trace parameter is explicitly provided", () => {
      it.todo("uses the provided do_not_trace value when true");
      it.todo("uses the provided do_not_trace value when false");
    });

    describe("when do_not_trace parameter is not provided but inputs.do_not_trace is provided", () => {
      it.todo("uses inputs.do_not_trace when true");
      it.todo("uses inputs.do_not_trace when false");
    });

    describe("when neither do_not_trace parameter nor inputs.do_not_trace is provided", () => {
      it.todo("sets do_not_trace to true when enable_tracing is false");
      it.todo("sets do_not_trace to false when enable_tracing is true");
    });
  });
});
