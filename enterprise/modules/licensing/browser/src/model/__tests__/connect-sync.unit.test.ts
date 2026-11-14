/**
 * @see specs/self-hosting/connected-services/connect-settings.feature
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
import { describe, expect, it } from "vitest";

import {
  areHostedServicesClosed,
  isRevokedByLangWatch,
  lastSyncedText,
  syncLineOf,
} from "../connect-sync.ts";

const LICENSE_REFUSALS = [
  "connect_license_revoked",
  "connect_license_expired",
  "connect_license_not_registered",
  "connect_wrong_instance",
] as const;

function liveRefusal(code: string) {
  return { refusal: { code }, sync: { lastSyncAt: null, lastError: null } };
}

function syncRefusal(code: string) {
  return { refusal: null, sync: { lastSyncAt: null, lastError: { code } } };
}

describe("given a refusal of the license itself", () => {
  /** @scenario "Every refusal of the license itself closes the hosted services" */
  it.each(LICENSE_REFUSALS)("closes the hosted services on a live %s", (code) => {
    expect(areHostedServicesClosed(liveRefusal(code))).toBe(true);
  });

  /** @scenario "Every refusal of the license itself closes the hosted services" */
  it.each(LICENSE_REFUSALS)("closes the hosted services when the last sync was %s", (code) => {
    expect(areHostedServicesClosed(syncRefusal(code))).toBe(true);
  });

  /** @scenario "Every refusal of the license itself closes the hosted services" */
  it.each(LICENSE_REFUSALS)("reads %s as revoked only when LangWatch revoked it", (code) => {
    const isRevoked = code === "connect_license_revoked";

    expect(isRevokedByLangWatch(liveRefusal(code))).toBe(isRevoked);
    expect(isRevokedByLangWatch(syncRefusal(code))).toBe(isRevoked);
  });
});

describe("given a sync that failed for a reason other than the license", () => {
  /** @scenario "A refusal that is not about the license leaves the hosted services open" */
  it("leaves the hosted services open", () => {
    expect(areHostedServicesClosed(syncRefusal("connect_unreachable"))).toBe(false);
    expect(
      areHostedServicesClosed({ refusal: null, sync: { lastSyncAt: null, lastError: null } }),
    ).toBe(false);
  });
});

describe("given a sync time that cannot be read", () => {
  /** @scenario "A sync time that cannot be read reads as not synced" */
  it("reads as not synced", () => {
    expect(lastSyncedText(null)).toBe("Not synced yet");
    expect(lastSyncedText("not a timestamp")).toBe("Not synced yet");
  });

  /** @scenario "A sync time that cannot be read reads as not synced" */
  it("still leads with the failure when the last sync failed", () => {
    expect(
      syncLineOf({ lastSyncAt: "not a timestamp", lastError: { code: "connect_unreachable" } }),
    ).toEqual({ text: "Last sync failed. Not synced yet.", failed: true });
  });
});
