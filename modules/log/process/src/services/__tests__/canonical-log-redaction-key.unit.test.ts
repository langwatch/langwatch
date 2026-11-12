/**
 * Each log record is redacted under its own key, the time it is stored under, so the PII
 * redaction model's priced request is one per record and not one per distinct text (ADR-201).
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { describe, expect, it } from "vitest";

import { CanonicalLogService, type LogRedaction } from "../canonical-log.service.ts";

const ACCEPTED_AT = 1_700_000_000_000;

function request(logRecords: unknown[]) {
  return {
    resourceLogs: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "worker" } }] },
        scopeLogs: [{ scope: { name: "test.scope" }, logRecords }],
      },
    ],
  };
}

function line(times: { timeUnixNano?: string; observedTimeUnixNano?: string }) {
  return { ...times, body: { stringValue: "payment failed for Jane Doe" } };
}

/** The record keys the redaction port was handed, one per record, in order. */
async function recordKeysOf(logRecords: unknown[]): Promise<(string | undefined)[]> {
  const keys: (string | undefined)[] = [];
  const redaction: LogRedaction = {
    redactLog: async (log) => {
      keys.push(log.recordKey);
    },
  };
  await CanonicalLogService.create({ redaction }).prepareCanonicalLogRecords({
    tenantId: "project_test",
    organizationId: "organization_test",
    request: request(logRecords),
    piiRedactionLevel: "STRICT",
    acceptedAt: ACCEPTED_AT,
  });

  return keys;
}

describe("given strict log records", () => {
  /** @scenario "A log record is keyed by the time it is stored under" */
  it("keys a record by its event time", async () => {
    await expect(
      recordKeysOf([
        line({ timeUnixNano: "1700000000123456789", observedTimeUnixNano: "1700000000999999999" }),
      ]),
    ).resolves.toEqual(["log:1700000000123456789"]);
  });

  /** @scenario "A log record is keyed by the time it is stored under" */
  it("falls back to the observed time, then to the time it was accepted", async () => {
    await expect(
      recordKeysOf([line({ observedTimeUnixNano: "1700000000999999999" }), line({})]),
    ).resolves.toEqual(["log:1700000000999999999", `log:${ACCEPTED_AT}000000`]);
  });

  /** @scenario "A log record is keyed by the time it is stored under" */
  it("gives a retried export the same keys", async () => {
    const records = [line({ timeUnixNano: "1700000000123456789" })];

    await expect(recordKeysOf(records)).resolves.toEqual(await recordKeysOf(records));
  });

  /** @scenario "A log record is keyed by the time it is stored under" */
  it("gives two identical lines at different times different keys", async () => {
    const [first, second] = await recordKeysOf([
      line({ timeUnixNano: "1700000000123456789" }),
      line({ timeUnixNano: "1700000060123456789" }),
    ]);

    expect(first).not.toBe(second);
  });

  /** @scenario "A log record is keyed by the time it is stored under" */
  it("still redacts a record whose time cannot be read, under a fixed key", async () => {
    await expect(recordKeysOf([line({ timeUnixNano: "not-a-time" })])).resolves.toEqual([
      "log:unreadable-time",
    ]);
  });
});
