/**
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */
import { describe, expect, it } from "vitest";

import {
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
} from "../platform-tool-policy.ts";

describe("Grok's platform tool policy", () => {
  /** @scenario Grok's platform policy has no virtual-key path */
  it("allows direct OTLP and no virtual key", () => {
    expect(PLATFORM_TOOL_POLICY_DEFAULTS.grok).toEqual({ allowVk: false, allowOtelDirect: true });
  });

  it("governs grok_cli keys under the grok slug", () => {
    expect(PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE.grok_cli).toBe("grok");
  });
});
