import type { ApiKey } from "@langwatch/api-key-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { foreignApiKeyIds, offerableApiKeys } from "../audience-api-keys.rules.ts";

const NOW = new Date("2026-11-26T12:00:00Z");

function key(overrides: Partial<ApiKey> & { id: string }): ApiKey {
  return {
    name: overrides.id,
    description: null,
    organizationId: "organization-1",
    userId: null,
    createdByUserId: null,
    createdByDeviceLabel: null,
    parentApiKeyId: null,
    lookupId: `lookup-${overrides.id}`,
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    isSystemManaged: false,
    createdByBrowserSessionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    grants: [],
    ...overrides,
  };
}

const SERVICE = key({ id: "key-service", name: "Trace analysis agent" });
const PERSONAL = key({ id: "key-personal", name: "Nightly eval runner", userId: "user-1" });
const REVOKED = key({ id: "key-revoked", revokedAt: new Date("2026-11-01T00:00:00Z") });
const EXPIRED = key({ id: "key-expired", expiresAt: new Date("2026-11-25T00:00:00Z") });
const MINTED = key({ id: "key-minted", name: "Langy session", isSystemManaged: true });
const INGEST = key({ id: "key-ingest", ingestSourceType: "otel_collector" });
const DOCS = key({ id: "key-docs", createdByBrowserSessionId: "session-1" });
const DEVICE_CHILD = key({ id: "key-child", parentApiKeyId: "key-login" });

describe("offerableApiKeys", () => {
  /** @scenario The audience picker lists the organization's keys by name */
  it("offers live service keys by the names their owners gave them", () => {
    expect(
      offerableApiKeys({
        keys: [SERVICE, PERSONAL, REVOKED, EXPIRED, MINTED, INGEST, DOCS, DEVICE_CHILD],
        now: fromDate(NOW),
      }),
    ).toEqual([{ id: "key-service", name: "Trace analysis agent" }]);
  });
});

describe("foreignApiKeyIds", () => {
  /** @scenario Saving a rule that names a key the organization does not have is refused */
  it("names the keys the organization does not have or LangWatch minted for itself", () => {
    expect(
      foreignApiKeyIds({
        named: ["key-service", "key-elsewhere", "key-minted", "key-revoked"],
        keys: [SERVICE, MINTED, REVOKED],
        kept: [],
        now: fromDate(NOW),
      }),
    ).toEqual(["key-elsewhere", "key-minted", "key-revoked"]);
  });

  /** @scenario Saving a rule that names a personal key is refused */
  it("refuses a personal key, which never reads more than the person who owns it", () => {
    expect(
      foreignApiKeyIds({ named: ["key-personal"], keys: [PERSONAL], kept: [], now: fromDate(NOW) }),
    ).toEqual(["key-personal"]);
  });

  it("lets a rule keep a key it already named after that key was revoked", () => {
    expect(
      foreignApiKeyIds({
        named: ["key-revoked"],
        keys: [SERVICE],
        kept: ["key-revoked"],
        now: fromDate(NOW),
      }),
    ).toEqual([]);
  });
});
