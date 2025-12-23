import { describe, it } from "vitest";

describe("VariablesForm", () => {
  describe("when rendering inputs", () => {
    it.todo("skips rendering when input.identifier is falsy");
    it.todo("renders input when input.identifier exists");
  });

  describe("when setting placeholder", () => {
    it.todo("uses 'image url' placeholder when input.type is 'image'");
    it.todo("uses undefined placeholder when input.type is 'str'");
    it.todo("uses type as placeholder for other types");
  });
});
