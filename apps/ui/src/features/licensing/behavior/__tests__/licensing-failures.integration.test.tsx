/**
 * @vitest-environment jsdom
 * The application's answer to a licence refusal, from a real transport error to
 * the modal. UX: specs/licensing/license-failure-modal.feature.
 */
import { showErrorToast } from "@langwatch/ui-host/errors";
import { setUiFeedbackHost } from "@langwatch/ui-host/toaster";
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { TRPCClientError } from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserUiFeedback } from "../../../../behavior/ui-feedback";

import {
  isHandledByGlobalLicenseHandler,
  isHandledByLiteMemberHandler,
} from "@langwatch/enterprise-licensing-web/surfaces/license-error-interceptor";
import type { UiFailureHost } from "../../../../behavior/ui-feature";
import { UiRpcPort, type UiRpcSubscription } from "../../../../behavior/ui-rpc";
import { licensingFailures } from "../licensing-failures";

class UnusedRpc extends UiRpcPort {
  query(): Promise<unknown> {
    return Promise.reject(new Error("not used"));
  }

  mutate(): Promise<unknown> {
    return Promise.reject(new Error("not used"));
  }

  subscribe(): UiRpcSubscription {
    return { unsubscribe: () => undefined };
  }
}

const host: UiFailureHost = { rpc: new UnusedRpc(), navigate: vi.fn() };

function failedCall(data: Record<string, unknown>): Error {
  const error = new TRPCClientError("Refused");
  (error as { data?: unknown }).data = data;
  return error;
}

afterEach(() => {
  useUpgradeModalStore.getState().close();
  setUiFeedbackHost(void 0);
  vi.clearAllMocks();
});

/** A limit refusal on the wire, as the server serialises one. */
function limitRefusal(limitType: string): Error {
  return failedCall({
    code: "FORBIDDEN",
    httpStatus: 403,
    cause: { limitType, current: 3, max: 3 },
  });
}

/**
 * The application's real toaster, over a recording target — so what is asserted
 * is what a reader would have seen, not what a stub decided to record.
 */
function recordingToaster() {
  const created: Array<{ title: string }> = [];
  const feedback = BrowserUiFeedback.create({
    create: (notice: { title: string }) => void created.push(notice),
    dismiss: () => undefined,
  } as never);
  setUiFeedbackHost(feedback);
  return { created, feedback };
}

describe("licensingFailures", () => {
  describe("when a call is refused because the organization is at a seat limit", () => {
    /** @scenario A refused call at a seat limit opens the upgrade modal */
    it("opens the upgrade modal on the limit and marks the refusal answered", () => {
      const error = failedCall({
        code: "FORBIDDEN",
        httpStatus: 403,
        cause: { limitType: "members", current: 3, max: 3 },
      });

      expect(licensingFailures(error, host)).toBe(true);

      const state = useUpgradeModalStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.variant).toEqual({
        mode: "limit",
        limitType: "members",
        current: 3,
        max: 3,
      });
      expect(isHandledByGlobalLicenseHandler(error)).toBe(true);
    });

    it("reads a limit that names no usage as zero of zero", () => {
      const error = failedCall({
        code: "FORBIDDEN",
        httpStatus: 403,
        cause: { limitType: "membersLite" },
      });

      expect(licensingFailures(error, host)).toBe(true);
      expect(useUpgradeModalStore.getState().variant).toEqual({
        mode: "limit",
        limitType: "membersLite",
        current: 0,
        max: 0,
      });
    });

    it("leaves a FORBIDDEN carrying no limit to the screen", () => {
      expect(licensingFailures(failedCall({ code: "FORBIDDEN", httpStatus: 403 }), host)).toBe(
        false,
      );
      expect(useUpgradeModalStore.getState().isOpen).toBe(false);
    });
  });

  describe("when a call is refused because the reader is on a Lite Member seat", () => {
    /** @scenario A refused call on a Lite Member seat opens the restriction modal */
    it("opens the restriction modal naming the resource and marks the refusal answered", () => {
      const error = failedCall({
        code: "UNAUTHORIZED",
        httpStatus: 401,
        error: { code: "lite_member_restricted", meta: { resource: "prompts" } },
      });

      expect(licensingFailures(error, host)).toBe(true);

      const state = useUpgradeModalStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.variant).toEqual({ mode: "liteMemberRestriction", resource: "prompts" });
      expect(isHandledByLiteMemberHandler(error)).toBe(true);
    });

    it("reads the deprecated `kind` discriminant an older server still sends", () => {
      const error = failedCall({
        code: "UNAUTHORIZED",
        httpStatus: 401,
        error: { kind: "lite_member_restricted", meta: { resource: "datasets" } },
      });

      expect(licensingFailures(error, host)).toBe(true);
      expect(useUpgradeModalStore.getState().variant).toEqual({
        mode: "liteMemberRestriction",
        resource: "datasets",
      });
    });

    it("leaves a vanilla UNAUTHORIZED to the screen", () => {
      expect(licensingFailures(failedCall({ code: "UNAUTHORIZED", httpStatus: 401 }), host)).toBe(
        false,
      );
      expect(useUpgradeModalStore.getState().isOpen).toBe(false);
    });
  });

  describe("when the failure has nothing to do with the licence", () => {
    /** @scenario A refusal the licence does not explain is left to the screen */
    it("answers that it reported nothing, so the screen still can", () => {
      expect(licensingFailures(new Error("network down"), host)).toBe(false);
      expect(useUpgradeModalStore.getState().isOpen).toBe(false);
    });
  });

  describe("when a creation form's own catch reports a refusal the modal already answered", () => {
    /** @scenario "Workflow creation error toast suppressed when license modal shown" */
    it("says nothing over the workflow limit dialog", () => {
      const { created, feedback } = recordingToaster();
      const error = limitRefusal("workflows");

      expect(licensingFailures(error, host)).toBe(true);
      feedback.failed({ error, fallbackTitle: "Couldn't create workflow" });

      expect(created).toEqual([]);
      expect(useUpgradeModalStore.getState().variant).toMatchObject({
        mode: "limit",
        limitType: "workflows",
      });
    });

    /** @scenario "Workflow agent creation error toast suppressed when license modal shown" */
    it("says nothing over the dialog when the workflow agent form reports", () => {
      const { created } = recordingToaster();
      const error = limitRefusal("workflows");

      expect(licensingFailures(error, host)).toBe(true);
      showErrorToast({ error, fallbackTitle: "Couldn't create workflow agent" });

      expect(created).toEqual([]);
    });

    /** @scenario "Workflow evaluator creation error toast suppressed when license modal shown" */
    it("says nothing over the dialog when the workflow evaluator form reports", () => {
      const { created } = recordingToaster();
      const error = limitRefusal("workflows");

      expect(licensingFailures(error, host)).toBe(true);
      showErrorToast({ error, fallbackTitle: "Couldn't create workflow evaluator" });

      expect(created).toEqual([]);
    });

    /** @scenario "Non-license errors still show toast" */
    it("still reports a failure the licence does not explain", () => {
      const { created } = recordingToaster();
      const error = new Error("network down");

      expect(licensingFailures(error, host)).toBe(false);
      showErrorToast({ error, fallbackTitle: "Couldn't create workflow" });

      expect(created).toHaveLength(1);
      expect(useUpgradeModalStore.getState().isOpen).toBe(false);
    });
  });
});
