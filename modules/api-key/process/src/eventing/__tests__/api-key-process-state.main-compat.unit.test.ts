import { describe, expect, it } from "vitest";

import { agentSandboxKeyReapStateSchema } from "../agent-sandbox-key-reap.process.ts";
import { cliLoginKeyReapStateSchema } from "../cli-login-key-reap.process.ts";

describe("process state stored by the main release", () => {
  it("parses an agent sandbox key reap state as main stored it", () => {
    expect(agentSandboxKeyReapStateSchema.parse({ lastReapAt: 1_760_000_000_000 })).toEqual({
      lastReapAt: 1_760_000_000_000,
    });
  });
  it("parses a CLI login key reap state as main stored it", () => {
    expect(cliLoginKeyReapStateSchema.parse({ lastReapAt: null })).toEqual({ lastReapAt: null });
  });
});
