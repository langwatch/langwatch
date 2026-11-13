/**
 * Who ran a key's LangWatchQL query: Langy's session key first, then the client it came from.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 * @see modules/staff-access/specs/staff-access-use.feature
 */
import type { LangWatchQLKeyReach } from "@langwatch/analytics-contract";
import { CENSUS_CLIENTS } from "@langwatch/observability/credential-census";
import { describe, expect, it } from "vitest";

import { keyDoorOfClient, keyMaySpend, keyRunTelemetry } from "../langwatch-ql-key-caller.rules.ts";

const organizationKey: LangWatchQLKeyReach = {
  kind: "apiKey",
  apiKeyId: "key-org",
  userId: null,
  organizationId: "org-1",
};

describe("keyRunTelemetry", () => {
  /** @scenario "Telemetry: a query Langy runs with its session key counts as langy" */
  it("names a Langy session key langy, whichever client it came from", () => {
    const langyKey = { ...organizationKey, isLangySessionKey: true };

    expect(keyRunTelemetry({ reach: langyKey, door: "cli" })).toEqual({ caller: "langy" });
    expect(keyRunTelemetry({ reach: langyKey, door: "mcp" })).toEqual({ caller: "langy" });
  });

  /** @scenario "Telemetry: a key's query is counted by the client that sent it" */
  it("names any other key by its client", () => {
    expect(keyRunTelemetry({ reach: organizationKey, door: "cli" })).toEqual({ caller: "cli" });
    expect(
      keyRunTelemetry({ reach: { kind: "project", projectId: "p-1" }, door: "rest_api" }),
    ).toEqual({ caller: "rest_api" });
  });
});

describe("keyDoorOfClient", () => {
  /** @scenario "Telemetry: a key's query is counted by the client that sent it" */
  it("keeps every client to three values", () => {
    const doors = new Set(CENSUS_CLIENTS.map((client) => keyDoorOfClient({ client })));

    expect([...doors].toSorted()).toEqual(["cli", "mcp", "rest_api"]);
  });
});

describe("keyMaySpend", () => {
  /** @scenario "A staff key without the spend tick cannot run LWQL eval functions" */
  it("refuses charged eval() functions to a staff key whose session was not approved to spend", () => {
    const staffKey = { ...organizationKey, isStaffAccessKey: true };

    expect(keyMaySpend({ ...staffKey, staffSpendApproved: false })).toBe(false);
    expect(keyMaySpend(staffKey)).toBe(false);
    expect(keyMaySpend({ ...staffKey, staffSpendApproved: true })).toBe(true);
  });

  it("leaves every other key to its project's own Instant Evals switch", () => {
    expect(keyMaySpend(organizationKey)).toBe(true);
    expect(keyMaySpend({ kind: "project", projectId: "p-1" })).toBe(true);
  });
});
