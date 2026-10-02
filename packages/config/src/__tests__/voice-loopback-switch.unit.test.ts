import { describe, expect, it } from "vitest";

import { Config, parseProcessConfig } from "../config.ts";
import { allowLoopbackVoiceProviders } from "../deployment-facts.ts";

/** Gateway and scenario each hold this leaf; two owners stand in for them. */
const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [
      { name: "gateway", config: Config.define(() => ({ allowLoopbackVoiceProviders })) },
      { name: "scenario", config: Config.define(() => ({ allowLoopbackVoiceProviders })) },
    ],
    environment,
  });

describe("the dev loopback voice switch", () => {
  /** @scenario The product reaches a loopback voice host only under the dev switch */
  it("is off unless the deployment sets the literal 1", () => {
    for (const value of [undefined, "", "0", "true", "yes"]) {
      const config = read({ VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS: value });
      expect(config.gateway.allowLoopbackVoiceProviders).toBe(false);
      expect(config.scenario.allowLoopbackVoiceProviders).toBe(false);
    }
  });

  it("is one shared leaf, so one variable turns every reader on", () => {
    const config = read({ VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS: "1" });
    expect(config.gateway.allowLoopbackVoiceProviders).toBe(true);
    expect(config.scenario.allowLoopbackVoiceProviders).toBe(true);
  });
});
