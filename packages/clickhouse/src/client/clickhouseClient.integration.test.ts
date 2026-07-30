import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readTestClickHouseInfo,
  uniqueTenant,
} from "../__tests__/integration/testClickHouse";
import {
  type ClickHouseClient,
  createClickHouseClient,
} from "./clickhouseClient";

/**
 * `test_append_log` is created once by `globalSetup.ts` with exactly three
 * columns (`TenantId`, `AcceptedAt`, `Payload`). This file proves the one
 * property no unit test can, because it depends on a real server enforcing
 * `input_format_skip_unknown_fields: 0` (ADR-109 decision 4): a column this
 * client sends that the deployed table does not have throws, rather than
 * being silently dropped.
 */
describe("given a client insert against a live ClickHouse", () => {
  let client: ClickHouseClient;

  beforeAll(() => {
    const { url } = readTestClickHouseInfo();
    client = createClickHouseClient({ url });
  });

  afterAll(async () => {
    await client.close();
  });

  /** @scenario an insert carrying a column the table does not declare throws */
  it("throws rather than silently dropping a column the deployed table does not declare", async () => {
    const tenantId = uniqueTenant();

    await expect(
      client.insert({
        tenantId,
        table: "test_append_log",
        columns: ["TenantId", "AcceptedAt", "Payload", "NotADeployedColumn"],
        rows: [[tenantId, new Date().toISOString(), "payload", "extra"]],
        target: { kind: "append", perRecordIdentity: false },
      }),
    ).rejects.toThrow();
  });
});
