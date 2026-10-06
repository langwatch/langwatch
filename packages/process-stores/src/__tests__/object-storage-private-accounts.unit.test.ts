/**
 * @see specs/private-dataplane/s3-routing.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { buildObjectStorage } from "../object-storage-member.ts";
import { objectStoragePrivateAccountsOf } from "../object-storage-private-accounts.ts";

const ACME = JSON.stringify({
  endpoint: "https://s3.acme.invalid",
  bucket: "acme-dataplane",
  accessKeyId: "content-marker",
  secretAccessKey: "content-marker",
});

const clock = { now: () => Temporal.Instant.from("2026-10-06T12:00:00Z") };

function parse(entries: Record<string, string>) {
  const { logger, lines } = createTestLogger();
  const accounts = objectStoragePrivateAccountsOf({
    family: new Map(Object.entries(entries)),
    logger,
  });
  return { accounts, lines };
}

describe("given the stores' DATAPLANE_S3__ family", () => {
  describe("when an entry holds a complete JSON config", () => {
    /** @scenario "Parse private S3 config from env var" */
    it("maps the organisation after the last separator to that account, ignoring the label", () => {
      const { accounts } = parse({ DATAPLANE_S3__acme__org123: ACME });

      expect(accounts).toEqual([
        {
          organizationId: "org123",
          bucket: "acme-dataplane",
          endpoint: "https://s3.acme.invalid",
          credentials: { accessKeyId: "content-marker", secretAccessKey: "content-marker" },
          forcePathStyle: true,
        },
      ]);
    });

    it("applies the shared S3_REGION to the account, as main did", () => {
      const accounts = objectStoragePrivateAccountsOf({
        family: new Map([["DATAPLANE_S3__acme__org123", ACME]]),
        region: "eu-west-1",
      });

      expect(accounts[0]).toMatchObject({ organizationId: "org123", region: "eu-west-1" });
    });
  });

  describe("when an entry is not JSON", () => {
    /** @scenario "Invalid JSON in S3 env var is logged and skipped" */
    it("skips it and warns by the variable's name, never its value", () => {
      const { accounts, lines } = parse({ DATAPLANE_S3__bad__org999: "not-json" });

      expect(accounts).toEqual([]);
      const warning = lines.findLine("warn", "invalid JSON");
      expect(warning).toMatchObject({
        envVar: "DATAPLANE_S3__bad__org999",
        organizationId: "org999",
      });
      expect(JSON.stringify(lines)).not.toContain("not-json");
    });
  });

  describe("when an entry is missing its credentials", () => {
    /** @scenario "S3 env var missing a field is logged and skipped" */
    it("skips it and warns naming the missing fields", () => {
      const partial = JSON.stringify({ endpoint: "https://s3.invalid", bucket: "partial" });
      const { accounts, lines } = parse({ DATAPLANE_S3__partial__org888: partial });

      expect(accounts).toEqual([]);
      expect(lines.findLine("warn", "invalid fields")).toMatchObject({
        envVar: "DATAPLANE_S3__partial__org888",
        fields: ["accessKeyId", "secretAccessKey"],
      });
    });
  });

  describe("when two entries name the same organisation", () => {
    /** @scenario "Two S3 env vars for one organisation refuse boot" */
    it("refuses, naming the organisation", () => {
      expect(() =>
        parse({ DATAPLANE_S3__one__org123: ACME, DATAPLANE_S3__two__org123: ACME }),
      ).toThrow(
        expect.objectContaining({
          name: "DuplicatePrivateStorageAccountError",
          organizationId: "org123",
        }),
      );
    });
  });
});

describe("given object storage built over the parsed family with a shared S3 bucket", () => {
  const storageFor = (organizationId: string) =>
    buildObjectStorage({
      config: {
        backend: "s3",
        s3: { bucket: "shared-bucket" },
        privateAccounts: parse({ DATAPLANE_S3__acme__org123: ACME }).accounts,
      },
      clock,
      directory: { organizationForTenant: () => Promise.resolve(organizationId) },
    });

  describe("when a project of the organisation with a private S3 is placed", () => {
    /** @scenario "Org with private S3 gets dedicated config" */
    it("answers the private bucket", async () => {
      const storage = storageFor("org123");

      await expect(storage.value.destination("project-1")).resolves.toEqual({
        kind: "s3",
        bucket: "acme-dataplane",
      });
      await storage.close?.();
    });
  });

  describe("when a project of an organisation without one is placed", () => {
    /** @scenario "Org without private S3 gets shared config" */
    it("answers the shared bucket", async () => {
      const storage = storageFor("org456");

      await expect(storage.value.destination("project-2")).resolves.toEqual({
        kind: "s3",
        bucket: "shared-bucket",
      });
      await storage.close?.();
    });
  });
});
