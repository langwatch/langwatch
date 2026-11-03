import { describe, expect, it } from "vitest";

import { mocksModules } from "../mocks-modules.ts";

describe("mocksModules", () => {
  describe("given a call that rewrites the module registry", () => {
    /** @scenario "Files that mock modules run isolated and the rest share modules" */
    it.each([
      'vi.mock("./store.ts");',
      'vi.doMock("./store.ts", () => ({}));',
      'vi.unmock("./store.ts");',
      'vi.doUnmock("./store.ts");',
      "vi.resetModules();",
      "const { spy } = vi.hoisted(() => ({ spy: 1 }));",
      'vi . mock ( "./store.ts" )',
    ])("recognises %s", (source) => {
      expect(mocksModules(source)).toBe(true);
    });
  });

  describe("given a call that only spies or stubs", () => {
    /** @scenario "Files that mock modules run isolated and the rest share modules" */
    it.each([
      "const fn = vi.fn();",
      'vi.spyOn(console, "log");',
      "vi.mocked(fn).mockReturnValue(1);",
      'vi.stubEnv("A", "1");',
      "mock(store);",
    ])("leaves %s alone", (source) => {
      expect(mocksModules(source)).toBe(false);
    });
  });
});
