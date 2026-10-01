import { describe, expect, it } from "vitest";

import { withSecretValues } from "../agent-test-destination.rules.ts";

describe("withSecretValues", () => {
  /** @scenario "A test call whose address resolves to another host through a secret is refused" */
  it("replaces each reference the way the engine does, so the address checked is the one called", () => {
    expect(
      withSecretValues({
        text: "https://{{ secrets.HOST }}@agent.test/{{secrets.PATH}}",
        values: { HOST: "elsewhere.test/x#", PATH: "chat" },
      }),
    ).toBe("https://elsewhere.test/x#@agent.test/chat");
  });

  it("leaves a reference to an unknown secret as it is", () => {
    expect(withSecretValues({ text: "{{ secrets.MISSING }}", values: {} })).toBe(
      "{{ secrets.MISSING }}",
    );
  });
});
