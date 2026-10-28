import { describe, expect, it } from "vitest";

import { loginAdviceIn, teardownLoginWorld } from "./login-world.ts";

describe("loginAdviceIn", () => {
  it("finds the whoami message passed on to the user", () => {
    expect(
      loginAdviceIn({
        text: "Not logged in. Run `langwatch login --device` to sign in via your company SSO.",
      }),
    ).toEqual(["Not logged in", "langwatch login", "login"]);
  });

  it("finds a claim that Langy has no CLI", () => {
    expect(loginAdviceIn({ text: "Sorry, I don't have access to the CLI here." })).toEqual([
      "don't have access to the CLI",
    ]);
  });

  it("finds nothing in a plain cost answer", () => {
    expect(
      loginAdviceIn({ text: "Most tokens went to three long sessions in the past hour." }),
    ).toEqual([]);
  });
});

describe("teardownLoginWorld", () => {
  it("reports issue 8770 reproduced when any turn passed on login advice", () => {
    const result = teardownLoginWorld({
      state: {
        facts_after_turn: { "1": { login_advice: [] }, "2": { login_advice: ["sign in"] } },
      },
    });

    expect(result.final_facts).toEqual({
      login_advice_any_turn: ["sign in"],
      reproduced_8770: true,
    });
  });
});
