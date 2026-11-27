// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The Security Lake reads decode each ClickHouse row against a schema: UInt64 columns arrive as
 * strings and become numbers, and a row of the wrong shape is refused rather than passed on.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { clickHouseClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

function repositoryOver(rows: unknown[]) {
  const client = clickHouseClientDouble({ query: async () => ({ json: async () => rows }) });
  return ClickHouseOcsfEventsRepository.create(async () => client);
}

const callersOf = (rows: unknown[]) =>
  repositoryOver(rows).findSecurityLakeCallers({ tenantId: "gov-1", sinceMs: 0, limit: 10 });

const countOf = (rows: unknown[]) =>
  repositoryOver(rows).countSecurityLakeEvents({ tenantId: "gov-1", sourceId: "src_1" });

describe("ClickHouseOcsfEventsRepository Security Lake reads", () => {
  describe("when the callers read answers", () => {
    /** @scenario "A Security Lake read refuses a row of the wrong shape" */
    it("decodes the UInt64 columns ClickHouse sends as strings", async () => {
      const callers = await callersOf([
        {
          Principal: "arn:aws:iam::123456789012:role/agent",
          Models: ["anthropic.claude-3"],
          Regions: ["eu-west-1"],
          LastCallMs: "1763300000000",
          CallCount: "4",
        },
      ]);

      expect(callers).toEqual([
        {
          principalArn: "arn:aws:iam::123456789012:role/agent",
          models: ["anthropic.claude-3"],
          regions: ["eu-west-1"],
          lastCallMs: 1_763_300_000_000,
          callCount: 4,
        },
      ]);
    });

    /** @scenario "A Security Lake read refuses a row of the wrong shape" */
    it("refuses a row whose models are not a list", async () => {
      await expect(
        callersOf([
          {
            Principal: "arn:aws:iam::123456789012:role/agent",
            Models: null,
            Regions: [],
            LastCallMs: "1",
            CallCount: "1",
          },
        ]),
      ).rejects.toMatchObject({
        name: "ZodError",
        issues: [expect.objectContaining({ code: "invalid_type", path: [0, "Models"] })],
      });
    });
  });

  describe("when the written count answers", () => {
    /** @scenario "A Security Lake read refuses a row of the wrong shape" */
    it("reads the count, and 0 with no row", async () => {
      expect(await countOf([{ Events: "3" }])).toBe(3);
      expect(await countOf([])).toBe(0);
    });

    /** @scenario "A Security Lake read refuses a row of the wrong shape" */
    it("refuses a count that is not a number", async () => {
      await expect(countOf([{ Events: "many" }])).rejects.toMatchObject({
        name: "ZodError",
        issues: [expect.objectContaining({ code: "invalid_type", path: [0, "Events"] })],
      });
    });
  });
});
