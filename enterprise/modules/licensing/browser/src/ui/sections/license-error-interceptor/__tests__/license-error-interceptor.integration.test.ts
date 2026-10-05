/**
 * @vitest-environment jsdom
 * specs/licensing/license-failure-modal.feature: the licensing declaration installs one
 * reader over every failed mutation, and that reader opens the upgrade modal.
 */

import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { installedModuleFailures } from "@langwatch/browser/application";
import { afterEach, describe, expect, it } from "vitest";

import { licensingWeb } from "../../../../licensing.web.ts";
import { reportLicenseFailure } from "../license-error-interceptor.ts";

/** A failed call as the tRPC client hands it over: an Error carrying the serialised `data`. */
function failedCall({ data }: { data: Record<string, unknown> }): Error {
  return Object.assign(new Error("refused"), { data });
}

afterEach(() => {
  useUpgradeModalStore.setState({ isOpen: false, variant: null });
});

describe("Feature: Upgrade modal when a call is refused by the licence", () => {
  it("installs reportLicenseFailure as the module's failure interceptor", () => {
    expect(installedModuleFailures([licensingWeb])).toEqual([reportLicenseFailure]);
  });

  /** @scenario A refused call at a seat limit opens the upgrade modal */
  it("A refused call at a seat limit opens the upgrade modal", () => {
    const error = failedCall({
      data: {
        code: "FORBIDDEN",
        error: { code: "resource_limit_exceeded", meta: { limitType: "members" } },
        cause: { limitType: "members", current: 5, max: 5 },
      },
    });

    expect(reportLicenseFailure(error)).toBe(true);

    expect(useUpgradeModalStore.getState().variant).toEqual({
      mode: "limit",
      limitType: "members",
      current: 5,
      max: 5,
    });
    expect(isHandledByGlobalHandler(error)).toBe(true);
  });

  /** @scenario A refused call on a Lite Member seat opens the restriction modal */
  it("A refused call on a Lite Member seat opens the restriction modal", () => {
    const error = failedCall({
      data: {
        code: "UNAUTHORIZED",
        error: { code: "lite_member_restricted", meta: { resource: "prompts" } },
      },
    });

    expect(reportLicenseFailure(error)).toBe(true);

    expect(useUpgradeModalStore.getState().variant).toEqual({
      mode: "liteMemberRestriction",
      resource: "prompts",
    });
    expect(isHandledByGlobalHandler(error)).toBe(true);
  });

  it("leaves a Developer seat denial to the generic error path, with no upgrade modal", () => {
    const error = failedCall({
      data: {
        code: "UNAUTHORIZED",
        error: { code: "developer_seat_restricted", meta: { resource: "project" } },
      },
    });

    expect(reportLicenseFailure(error)).toBe(false);

    expect(useUpgradeModalStore.getState().variant).toBeNull();
    expect(isHandledByGlobalHandler(error)).toBe(false);
  });

  /** @scenario A refusal the licence does not explain is left to the screen */
  it("A refusal the licence does not explain is left to the screen", () => {
    const error = failedCall({
      data: { code: "FORBIDDEN", error: { code: "permission_denied" } },
    });

    expect(reportLicenseFailure(error)).toBe(false);

    expect(useUpgradeModalStore.getState().isOpen).toBe(false);
    expect(isHandledByGlobalHandler(error)).toBe(false);
  });
});
