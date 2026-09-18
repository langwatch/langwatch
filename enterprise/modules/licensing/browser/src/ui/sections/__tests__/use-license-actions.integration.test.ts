/**
 * @vitest-environment jsdom
 *
 * Tests SSO license gating: activation requires restart on self-hosted deployments
 * because the SSO gate is decided once per process (ADR-027).
 */

import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LicensingFailureNotice,
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingSuccessNotice,
} from "../../../model/licensing-host.ts";
import { useLicenseActions } from "../use-license-actions.ts";

const { uploadMutationOptions, removeMutationOptions, publicEnvData, invalidateMock, toaster } =
  vi.hoisted(() => ({
    uploadMutationOptions: { current: null as null | Record<string, any> },
    removeMutationOptions: { current: null as null | Record<string, any> },
    publicEnvData: {
      current: undefined as undefined | { IS_SAAS: boolean },
    },
    invalidateMock: vi.fn(),
    toaster: { create: vi.fn() },
  }));

// `trpc.invalidate()` replaced a full-page reload that used to tear the
// toast off-screen; this spy guards the regression. The hook cannot reach
// the browser directly — the host port has no reload method — so this spy
// is the unwired seam a reload would have to go through.
const { reloadPage } = vi.hoisted(() => ({ reloadPage: vi.fn() }));

vi.mock("../../../behavior/licensing-api.ts", () => ({
  licensingApi: {
    license: {
      upload: {
        useMutation: (options: Record<string, any>) => {
          uploadMutationOptions.current = options;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      remove: {
        useMutation: (options: Record<string, any>) => {
          removeMutationOptions.current = options;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

/**
 * What the platform page's host does with each notice: a success notice is a
 * success toast, and `publicEnvData` is `usePublicEnv().data` — undefined
 * while the environment is still resolving.
 */
class TestLicensingHost extends LicensingHostApi {
  organizationId(): string | undefined {
    return "org-1";
  }

  isSaaS(): boolean {
    return publicEnvData.current?.IS_SAAS ?? false;
  }

  isDeploymentSettled(): boolean {
    return publicEnvData.current !== undefined;
  }

  licensePurchaseUrl(): string | undefined {
    return undefined;
  }

  refreshPlanDerivedState(): void {
    invalidateMock();
  }

  succeeded(notice: LicensingSuccessNotice): void {
    toaster.create({ ...notice, type: "success" });
  }

  failed(failure: LicensingFailureNotice): void {
    toaster.create({ title: failure.fallbackTitle, type: "error" });
  }
}

const host = new TestLicensingHost();

const Wrapper = ({ children }: { children: ReactNode }) =>
  createElement(LicensingHostProvider, { value: host }, children);

const renderActions = () =>
  renderHook(
    () =>
      useLicenseActions({
        organizationId: "org-1",
        onUploadSuccess: vi.fn(),
        onRemoveSuccess: vi.fn(),
      }),
    { wrapper: Wrapper },
  );

describe("useLicenseActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMutationOptions.current = null;
    removeMutationOptions.current = null;
  });

  describe("when a license is activated on a self-hosted deployment", () => {
    /** @scenario Activating a license takes effect at the next restart */
    it("tells the admin a restart is required to enable SSO", () => {
      publicEnvData.current = { IS_SAAS: false };

      renderActions();
      uploadMutationOptions.current?.onSuccess();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "License activated",
          description: expect.stringContaining("restart the server"),
          type: "success",
        }),
      );
    });
  });

  describe("when a license is activated on LangWatch Cloud", () => {
    it("does not mention a server restart", () => {
      publicEnvData.current = { IS_SAAS: true };

      renderActions();
      uploadMutationOptions.current?.onSuccess();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.not.stringContaining("restart"),
        }),
      );
    });
  });

  describe("when the environment has not resolved yet", () => {
    /** @scenario Activating a license takes effect at the next restart */
    it("still tells the admin to restart, because only a confirmed IS_SAAS means Cloud", () => {
      publicEnvData.current = undefined;

      renderActions();
      uploadMutationOptions.current?.onSuccess();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("restart the server"),
        }),
      );
    });
  });

  describe("when the confirmation has to survive long enough to be read", () => {
    /** @scenario The restart instruction outlives the activation it belongs to */
    it("leaves the page in place after activation and refreshes plan state instead", () => {
      publicEnvData.current = { IS_SAAS: false };

      renderActions();
      uploadMutationOptions.current?.onSuccess();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("restart the server"),
        }),
      );
      expect(reloadPage).not.toHaveBeenCalled();
      // The state the reload used to refresh: plan, navigation, feature gates.
      expect(invalidateMock).toHaveBeenCalled();
    });

    /** @scenario Removing a license confirms it without discarding the confirmation */
    it("leaves the page in place after removal and refreshes plan state instead", () => {
      publicEnvData.current = { IS_SAAS: false };

      renderActions();
      removeMutationOptions.current?.onSuccess();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "License removed" }),
      );
      expect(reloadPage).not.toHaveBeenCalled();
      expect(invalidateMock).toHaveBeenCalled();
    });
  });
});
