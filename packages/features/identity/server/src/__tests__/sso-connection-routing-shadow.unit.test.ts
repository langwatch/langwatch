import type { RoutableConnection } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import type { SignInDomainRoutingPort } from "../signin-router.service";
import {
  ShadowComparingDomainRoutingRepository,
  type SsoConnectionRoutingShadowRecord,
} from "../sso-connection-routing-shadow";

function routable(
  overrides: Partial<RoutableConnection> & { connectionId: string },
): RoutableConnection {
  return {
    method: {
      id: "okta",
      kind: "federated",
      connectionId: overrides.connectionId,
    },
    state: "ACTIVE",
    configured: true,
    allowsJit: true,
    ...overrides,
  };
}

class StubRouting implements SignInDomainRoutingPort {
  constructor(
    private readonly answer: RoutableConnection | null,
    private readonly failure?: Error,
  ) {}

  async tryFindConnectionForDomain() {
    if (this.failure) throw this.failure;
    return this.answer;
  }

  async listActiveConnections() {
    if (this.failure) throw this.failure;
    return this.answer ? [this.answer] : [];
  }
}

function recorderOf() {
  const records: SsoConnectionRoutingShadowRecord[] = [];
  return {
    records,
    recorder: {
      compared: (record: SsoConnectionRoutingShadowRecord) => void records.push(record),
    },
  };
}

describe("sso connection routing shadow mode", () => {
  describe("given the strings and the projection agree", () => {
    /** @scenario "Shadow mode compares connection routing against string routing" */
    it("runs both lookups and returns the string-based answer", async () => {
      const { records, recorder } = recorderOf();
      const strings = routable({ connectionId: "org:org_acme" });
      const port = new ShadowComparingDomainRoutingRepository({
        deciding: new StubRouting(strings),
        shadow: new StubRouting(routable({ connectionId: "ssoc_1" })),
        recorder,
      });

      const decided = await port.tryFindConnectionForDomain({
        domain: "acme.com",
      });

      expect(decided).toBe(strings);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        lookup: "domain",
        domain: "acme.com",
        comparison: { matches: true },
      });
    });
  });

  describe("given they disagree", () => {
    /** @scenario "Shadow mode compares connection routing against string routing" */
    it("logs both answers and still lets the strings decide", async () => {
      const { records, recorder } = recorderOf();
      const strings = routable({ connectionId: "org:org_acme" });
      const port = new ShadowComparingDomainRoutingRepository({
        deciding: new StubRouting(strings),
        // The projection has the connection paused; the strings carry no
        // lifecycle at all, so they say it is serving traffic.
        shadow: new StubRouting(routable({ connectionId: "ssoc_1", state: "SUSPENDED" })),
        recorder,
      });

      const decided = await port.tryFindConnectionForDomain({
        domain: "acme.com",
      });

      expect(decided).toBe(strings);
      expect(records[0]?.comparison).toMatchObject({
        matches: false,
        legacy: { state: "ACTIVE", methodId: "okta" },
        connection: { state: "SUSPENDED", methodId: "okta" },
      });
    });

    /** @scenario "Shadow mode compares connection routing against string routing" */
    it("ignores the connection id, which differs for every organization", async () => {
      const { records, recorder } = recorderOf();
      const port = new ShadowComparingDomainRoutingRepository({
        deciding: new StubRouting(routable({ connectionId: "org:org_acme" })),
        shadow: new StubRouting(routable({ connectionId: "ssoc_gf_org_acme" })),
        recorder,
      });

      await port.tryFindConnectionForDomain({ domain: "acme.com" });

      expect(records[0]?.comparison?.matches).toBe(true);
    });
  });

  describe("given the projection lookup fails", () => {
    /** @scenario "Shadow mode compares connection routing against string routing" */
    it("records the failure instead of counting it as agreement", async () => {
      const { records, recorder } = recorderOf();
      const strings = routable({ connectionId: "org:org_acme" });
      const port = new ShadowComparingDomainRoutingRepository({
        deciding: new StubRouting(strings),
        shadow: new StubRouting(null, new Error("projection unreadable")),
        recorder,
      });

      const decided = await port.tryFindConnectionForDomain({
        domain: "acme.com",
      });

      // The sign-in is unaffected — that is the one thing shadow mode must
      // never break.
      expect(decided).toBe(strings);
      expect(records[0]?.comparison).toBeNull();
      expect(records[0]?.error).toBeInstanceOf(Error);
    });
  });

  describe("given no address was submitted", () => {
    /** @scenario "Shadow mode compares connection routing against string routing" */
    it("compares the sole connection each side would auto-redirect to", async () => {
      const { records, recorder } = recorderOf();
      const strings = routable({ connectionId: "env:okta" });
      const port = new ShadowComparingDomainRoutingRepository({
        deciding: new StubRouting(strings),
        shadow: new StubRouting(null),
        recorder,
      });

      const decided = await port.listActiveConnections();

      expect(decided).toEqual([strings]);
      expect(records[0]).toMatchObject({
        lookup: "active_connections",
        domain: null,
        comparison: { matches: false, connection: { routes: false } },
      });
    });
  });
});
