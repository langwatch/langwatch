import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { isObjectRetentionConfirmed, storedObjectConfig } from "../stored-object.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "stored-object", config: storedObjectConfig }],
    environment,
  })["stored-object"];

const confirmed = (environment: Record<string, string | undefined>) =>
  isObjectRetentionConfirmed({ config: read(environment) });

describe("stored object server configuration", () => {
  describe("given the spool retention confirmation is absent", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the confirmation as withheld", () => {
      expect(read({}).objectRetentionConfirmed).toBeUndefined();
    });
  });

  describe("given neither retention variable is set", () => {
    /** @scenario "Neither variable set leaves the retention unconfirmed" */
    it("does not confirm", () => {
      expect(confirmed({})).toBe(false);
    });
  });

  describe("given OBJECT_RETENTION_CONFIRMED is 1 or true", () => {
    /** @scenario "The object retention variable confirms every prefix" */
    it.each(["true", "1", "TRUE"])("confirms on %s", (value) => {
      expect(confirmed({ OBJECT_RETENTION_CONFIRMED: value })).toBe(true);
    });
  });

  describe("given only the earlier Azure spool variable is true", () => {
    /** @scenario "The earlier Azure spool variable still confirms" */
    it("confirms", () => {
      expect(confirmed({ AZURE_BLOB_SPOOL_RETENTION_CONFIRMED: "true" })).toBe(true);
    });
  });

  describe("given the new variable is false and the earlier one is true", () => {
    /** @scenario "An explicit refusal on the new variable wins over the earlier one" */
    it("does not confirm", () => {
      expect(
        confirmed({
          OBJECT_RETENTION_CONFIRMED: "false",
          AZURE_BLOB_SPOOL_RETENTION_CONFIRMED: "true",
        }),
      ).toBe(false);
    });
  });

  describe("given a value other than 1 or true", () => {
    /** @scenario "Any value other than 1 or true does not confirm" */
    it.each(["yes", "", "0"])("does not confirm on %j", (value) => {
      expect(confirmed({ OBJECT_RETENTION_CONFIRMED: value })).toBe(false);
    });
  });
});
