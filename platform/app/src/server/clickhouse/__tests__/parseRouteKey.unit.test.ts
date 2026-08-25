import { describe, expect, it } from "vitest";
import { parseRouteKey } from "../privateRouteKey";

/**
 * Reading a cluster's name out of `CLICKHOUSE_URL__<label>__<orgId>`.
 *
 * The label was parsed and discarded for as long as private instances have
 * existed, documented as "ignored by code". It is the only human-readable name
 * the platform has for a customer's dedicated ClickHouse, and its absence had a
 * cost: a private instance rejected ~5.6k statements in three hours on
 * 2026-08-13 and no log line said which cluster refused them.
 */

const prefix = "CLICKHOUSE_URL__";

describe("parseRouteKey", () => {
  describe("given a labelled env var", () => {
    it("routes on the org id and names the cluster after the label", () => {
      expect(parseRouteKey({ key: `${prefix}acme__org_abc123`, prefix })).toEqual({
        orgId: "org_abc123",
        cluster: "acme",
      });
    });
  });

  describe("given a label that itself contains the separator", () => {
    /**
     * The org id is taken from the LAST separator, not the first. A label is
     * free text a person wrote; splitting on the first "__" would route
     * "acme__eu" to org "eu" and send a customer's traffic to the wrong
     * cluster — or, more likely, to none.
     */
    it("keeps the whole label and still routes on the trailing org id", () => {
      expect(parseRouteKey({ key: `${prefix}acme__eu__org_abc123`, prefix })).toEqual({
        orgId: "org_abc123",
        cluster: "acme__eu",
      });
    });
  });

  describe("given no label at all", () => {
    it("falls back to the org id, so the field is never empty", () => {
      expect(parseRouteKey({ key: `${prefix}org_abc123`, prefix })).toEqual({
        orgId: "org_abc123",
        cluster: "org_abc123",
      });
    });

    it("treats a leading separator as unlabelled rather than as an empty name", () => {
      expect(parseRouteKey({ key: `${prefix}__org_abc123`, prefix })).toEqual({
        orgId: "org_abc123",
        cluster: "org_abc123",
      });
    });
  });

  describe("given nothing to route", () => {
    it("returns null for a bare prefix", () => {
      expect(parseRouteKey({ key: prefix, prefix })).toBeNull();
    });

    it("returns null when the org id segment is empty", () => {
      expect(parseRouteKey({ key: `${prefix}acme__`, prefix })).toBeNull();
    });
  });
});
