import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  GATE_QUERY_TIMEOUT_MS,
  GATE_STATEMENT_TIMEOUT_MS,
  gatePoolConfig,
  guardGatePool,
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

  /** @scenario "The gate's connection survives Postgres terminating it while idle" */
  it("reports an idle connection loss as a warning instead of throwing", () => {
    const warn = vi.fn();
    const pool = guardGatePool({ pool: new pg.Pool(), warn });

    expect(() =>
      pool.emit("error", new Error("terminating connection due to administrator command")),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith("gate connection lost while idle", {
      error: "terminating connection due to administrator command",
    });
  });
});
