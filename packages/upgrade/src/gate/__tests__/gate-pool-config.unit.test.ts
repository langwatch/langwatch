import { describe, expect, it } from "vitest";

import { gatePoolConfig } from "../serving-upgrade-gate.ts";

describe("gatePoolConfig", () => {
  it("pins the session to UTC beside the search_path", () => {
    const { options } = gatePoolConfig({ databaseUrl: "postgres://u@h/db?schema=s1" });
    expect(options).toBe('-c search_path="s1" -c TimeZone=UTC');
  });

  it("pins the session to UTC with no schema", () => {
    const { options } = gatePoolConfig({ databaseUrl: "postgres://u@h/db" });
    expect(options).toBe("-c TimeZone=UTC");
  });
});
