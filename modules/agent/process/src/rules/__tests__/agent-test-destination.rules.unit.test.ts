import { describe, expect, it } from "vitest";

import { sendsBoundSecretElsewhere, withSecretValues } from "../agent-test-destination.rules.ts";

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

describe("sendsBoundSecretElsewhere", () => {
  const origins = { HTTP_AGENT_AUTH_TOKEN: "https://agent.test" };
  const sent = { auth: { type: "bearer", token: "{{ secrets.HTTP_AGENT_AUTH_TOKEN }}" } };

  /** @scenario "An agent test refuses to send a bound secret to another address" */
  it("refuses a bound secret sent to another scheme, host or port", () => {
    expect(sendsBoundSecretElsewhere({ sent, url: "https://elsewhere.test/chat", origins })).toBe(
      true,
    );
    expect(sendsBoundSecretElsewhere({ sent, url: "http://agent.test/chat", origins })).toBe(true);
  });

  /** @scenario "An agent test refuses to send a bound secret to another address" */
  it("allows a bound secret at its origin, and an unbound one anywhere", () => {
    expect(sendsBoundSecretElsewhere({ sent, url: "https://agent.test/v2", origins })).toBe(false);
    expect(
      sendsBoundSecretElsewhere({
        sent: { headers: [{ key: "X-Api-Key", value: "{{ secrets.PARTNER_TOKEN }}" }] },
        url: "https://elsewhere.test",
        origins,
      }),
    ).toBe(false);
  });
});
