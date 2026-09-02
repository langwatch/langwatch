/**
 * @vitest-environment node
 *
 * The `DATAPLANE_S3__<label>__<organizationId>` routing table every process
 * that addresses a tenant's own bucket resolves through.
 *
 * Driven off an explicit source rather than `process.env`, because the source
 * is an argument: a process reading a validated configuration and one reading
 * raw environment strings must resolve the same routes.
 */
import { describe, expect, it } from "vitest";

import { parseDataplaneS3RoutingTable } from "../dataplane-s3";

const ACME = {
  endpoint: "https://s3.eu-central-1.amazonaws.com",
  bucket: "langwatch-storage-acme",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret123",
};

const BETA = {
  endpoint: "https://s3.us-west-2.amazonaws.com",
  bucket: "langwatch-storage-beta",
  accessKeyId: "AKIABETA",
  secretAccessKey: "betasecret",
};

describe("the private S3 routing table", () => {
  describe("given valid route variables", () => {
    /** @scenario Parse private S3 config from env var */
    it("routes one organization to its own account", () => {
      const { routes } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__acme__org123: JSON.stringify(ACME),
      });

      expect(routes.get("org123")).toEqual(ACME);
    });

    it("routes each organization independently", () => {
      const { routes } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__acme__org123: JSON.stringify(ACME),
        DATAPLANE_S3__beta__org456: JSON.stringify(BETA),
      });

      expect(routes.get("org123")).toEqual(ACME);
      expect(routes.get("org456")).toEqual(BETA);
    });

    it("keys the route by the last segment, so the label carries no meaning", () => {
      const { routes } = parseDataplaneS3RoutingTable({
        "DATAPLANE_S3__any-label-here__org123": JSON.stringify(ACME),
      });

      expect(routes.get("org123")?.bucket).toBe("langwatch-storage-acme");
    });

    it("takes a name with no label at all as the organization id", () => {
      const { routes } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__org123: JSON.stringify(ACME),
      });

      expect(routes.get("org123")).toEqual(ACME);
    });

    it("leaves every other variable alone", () => {
      const { routes, skipped } = parseDataplaneS3RoutingTable({
        S3_BUCKET_NAME: "shared",
        DATAPLANE_CLICKHOUSE__acme__org123: "not mine",
      });

      expect(routes.size).toBe(0);
      expect(skipped).toEqual([]);
    });
  });

  describe("given a variable that is not valid JSON", () => {
    /** @scenario Invalid JSON in S3 env var is logged and skipped */
    it("skips it and reports which one, rather than failing the boot", () => {
      const { routes, skipped } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__bad__org999: "not-json",
      });

      expect(routes.has("org999")).toBe(false);
      expect(skipped).toEqual([{ envVar: "DATAPLANE_S3__bad__org999", reason: "not_json" }]);
    });

    it("still routes the organizations whose variables are well formed", () => {
      const { routes } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__bad__org999: "not-json",
        DATAPLANE_S3__acme__org123: JSON.stringify(ACME),
      });

      expect(routes.get("org123")).toEqual(ACME);
    });
  });

  describe("given a variable missing required fields", () => {
    it("skips it and reports the shape as the reason", () => {
      const { routes, skipped } = parseDataplaneS3RoutingTable({
        DATAPLANE_S3__partial__org888: JSON.stringify({
          endpoint: "https://s3.amazonaws.com",
        }),
      });

      expect(routes.has("org888")).toBe(false);
      expect(skipped).toEqual([
        { envVar: "DATAPLANE_S3__partial__org888", reason: "invalid_shape" },
      ]);
    });
  });

  describe("given no route variables at all", () => {
    it("routes nobody, which is how the shared bucket stays the default", () => {
      const { routes } = parseDataplaneS3RoutingTable({});

      expect(routes.size).toBe(0);
    });
  });

  describe("given two variables naming the same organization", () => {
    it("refuses, because writing that tenant's objects to the wrong account is silent", () => {
      expect(() =>
        parseDataplaneS3RoutingTable({
          DATAPLANE_S3__acme__org123: JSON.stringify(ACME),
          DATAPLANE_S3__acme_renamed__org123: JSON.stringify(BETA),
        }),
      ).toThrow(/Duplicate private S3 config for organization "org123"/);
    });
  });
});
