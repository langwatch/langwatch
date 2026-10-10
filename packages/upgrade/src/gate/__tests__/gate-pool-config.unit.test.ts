import { describe, expect, it } from "vitest";

import {
  GATE_QUERY_TIMEOUT_MS,
  GATE_STATEMENT_TIMEOUT_MS,
  gatePoolConfig,
} from "../serving-upgrade-gate.ts";

describe("gatePoolConfig", () => {
  it("pins the session to UTC beside the search_path", () => {
    const { options } = gatePoolConfig({ databaseUrl: "postgres://u@h/db?schema=s1" });
    expect(options).toBe('-c search_path="s1" -c TimeZone=UTC');
  });

  it("pins the session to UTC with no schema", () => {
    const { options } = gatePoolConfig({ databaseUrl: "postgres://u@h/db" });
    expect(options).toBe("-c TimeZone=UTC");
  });

  /** @scenario "The gate's connection gives up on a statement that never answers" */
  it("gives every statement a server-side timeout and the client a slightly longer one", () => {
    const config = gatePoolConfig({ databaseUrl: "postgres://u@h/db" });
    expect(config).toMatchObject({
      statement_timeout: GATE_STATEMENT_TIMEOUT_MS,
      query_timeout: GATE_QUERY_TIMEOUT_MS,
    });
    expect(GATE_QUERY_TIMEOUT_MS).toBeGreaterThan(GATE_STATEMENT_TIMEOUT_MS);
  });
});
