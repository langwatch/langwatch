import { describe, expect, it } from "vitest";

import { settingsToneFor } from "../src/components/settings-card.tsx";

describe("the settings card's two tone vocabularies", () => {
  it("maps each chip tone onto the dot that says the same thing", () => {
    expect(settingsToneFor("good")).toBe("ok");
    expect(settingsToneFor("warning")).toBe("warning");
    expect(settingsToneFor("bad")).toBe("bad");
    expect(settingsToneFor("neutral")).toBe("neutral");
  });
});
