/**
 * @see specs/private-dataplane/clickhouse-routing.feature, "Recorded private organizations"
 * @see specs/private-dataplane/s3-routing.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { buildObjectStorage } from "../object-storage-member.ts";
import { objectStoragePrivateFamilyOf } from "../object-storage-private-accounts.ts";
import { PrivateDataplaneRefusals } from "../private-dataplane-refusal.ts";

const clock = { now: () => Temporal.Instant.from("2026-10-11T12:00:00Z") };

const ACME = JSON.stringify({
  endpoint: "https://s3.acme.invalid",
  bucket: "acme-dataplane",
  accessKeyId: "content-marker",
  secretAccessKey: "content-marker",
});

describe("PrivateDataplaneRefusals", () => {
  describe("when one organization's requests are refused many times", () => {
    /** @scenario "A refused private organization is logged once per process, organization and kind" */
    it("logs one error line per organization and kind, and answers each with the handled 503", () => {
      const { logger, lines } = createTestLogger();
      const refusals = PrivateDataplaneRefusals.create({ logger });
      const refusal = {
        organizationId: "org_1",
        variable: "CLICKHOUSE_URL__acme__org_1",
        problem: "missing" as const,
      };

      const errors = [1, 2, 3].map(() => refusals.refuse({ ...refusal, kind: "clickhouse" }));
      refusals.refuse({ ...refusal, kind: "s3", variable: "DATAPLANE_S3__acme__org_1" });

      expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
      for (const error of errors) {
        expect(HandledError.isHandled(error)).toBe(true);
        expect(error.code).toBe("private_dataplane_unavailable");
        expect(error.httpStatus).toBe(503);
        expect(error.meta).toMatchObject({
          organizationId: "org_1",
          kind: "clickhouse",
          variable: "CLICKHOUSE_URL__acme__org_1",
          problem: "missing",
        });
      }
    });
  });
});

describe("object storage, given organizations recorded as private", () => {
  const storageOver = ({
    family,
    recordedS3Label,
  }: {
    family: Record<string, string>;
    recordedS3Label: string | null;
  }) => {
    const { accounts, malformed } = objectStoragePrivateFamilyOf({
      family: new Map(Object.entries(family)),
      logger: createTestLogger().logger,
    });
    return buildObjectStorage({
      config: {
        backend: "s3",
        s3: { bucket: "shared-bucket" },
        privateAccounts: accounts,
        malformedPrivateAccounts: malformed,
      },
      clock,
      directory: {
        organizationForTenant: () => Promise.resolve("org123"),
        recordedPrivateDataplaneOf: () =>
          Promise.resolve({ clickhouseLabel: null, s3Label: recordedS3Label }),
      },
    });
  };

  describe("when the recorded organization's S3 variable is missing", () => {
    /** @scenario "A recorded private organization whose S3 variable is missing is refused" */
    it("refuses its project, naming the variable as missing, never the shared bucket", async () => {
      const storage = storageOver({ family: {}, recordedS3Label: "acme" });

      await expect(storage.value.destination("project-1")).rejects.toMatchObject({
        code: "private_dataplane_unavailable",
        meta: { kind: "s3", variable: "DATAPLANE_S3__acme__org123", problem: "missing" },
      });
      await storage.close?.();
    });
  });

  describe("when the organization's S3 variable is malformed", () => {
    /** @scenario "An organization whose S3 variable is malformed is refused" */
    it("refuses its project, naming the variable as malformed", async () => {
      const partial = JSON.stringify({ endpoint: "https://s3.invalid", bucket: "partial" });
      const storage = storageOver({
        family: { DATAPLANE_S3__acme__org123: partial },
        recordedS3Label: null,
      });

      await expect(storage.value.destination("project-1")).rejects.toMatchObject({
        code: "private_dataplane_unavailable",
        meta: { variable: "DATAPLANE_S3__acme__org123", problem: "malformed" },
      });
      expect(storage.value.privateAccountVariables()).toEqual([
        {
          organizationId: "org123",
          label: "acme",
          variable: "DATAPLANE_S3__acme__org123",
          state: "malformed",
        },
      ]);
      await storage.close?.();
    });
  });

  describe("when the recorded organization's S3 variable is present", () => {
    it("places its project on its own bucket and lists the variable as present", async () => {
      const storage = storageOver({
        family: { DATAPLANE_S3__acme__org123: ACME },
        recordedS3Label: "acme",
      });

      await expect(storage.value.destination("project-1")).resolves.toEqual({
        kind: "s3",
        bucket: "acme-dataplane",
      });
      expect(storage.value.privateAccountVariables()).toMatchObject([{ state: "present" }]);
      await storage.close?.();
    });
  });
});
