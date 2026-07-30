/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/sso-license-gating.feature — license activation is a
 * paid entry point, but the SSO gate is decided once per process (ADR-027),
 * so the activation flow must tell self-hosted admins a restart is required.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toaster } from "../../ui/toaster";
import { useLicenseActions } from "../useLicenseActions";

const {
  uploadMutationOptions,
  removeMutationOptions,
  publicEnvData,
  invalidateMock,
} = vi.hoisted(() => ({
  uploadMutationOptions: { current: null as null | Record<string, any> },
  removeMutationOptions: { current: null as null | Record<string, any> },
  publicEnvData: {
    current: undefined as undefined | { IS_SAAS: boolean },
  },
  invalidateMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({ invalidate: invalidateMock }),
    license: {
      upload: {
        useMutation: (options: Record<string, any>) => {
          uploadMutationOptions.current = options;
          return { mutate: vi.fn(), isLoading: false };
        },
      },
      remove: {
        useMutation: (options: Record<string, any>) => {
          removeMutationOptions.current = options;
          return { mutate: vi.fn(), isLoading: false };
        },
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvData.current }),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

const renderActions = () =>
  renderHook(() =>
    useLicenseActions({
      organizationId: "org-1",
      onUploadSuccess: vi.fn(),
      onRemoveSuccess: vi.fn(),
    }),
  );

describe("useLicenseActions", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadMutationOptions.current = null;
    removeMutationOptions.current = null;
    // A full-page reload used to run in the same tick as the toast below and
    // tore it off the screen. Spying on it is how that regression announces
    // itself here rather than only in a browser.
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
  });

  describe("when a license is activated on a self-hosted deployment", () => {
    /** @scenario Activating a license takes effect at the next restart */
    it("tells the admin a restart is required to enable SSO", () => {
      publicEnvData.current = { IS_SAAS: false };

      renderHook(() =>
        useLicenseActions({
          organizationId: "org-1",
          onUploadSuccess: vi.fn(),
          onRemoveSuccess: vi.fn(),
        }),
      );
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

      renderHook(() =>
        useLicenseActions({
          organizationId: "org-1",
          onUploadSuccess: vi.fn(),
          onRemoveSuccess: vi.fn(),
        }),
      );
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

      renderHook(() =>
        useLicenseActions({
          organizationId: "org-1",
          onUploadSuccess: vi.fn(),
          onRemoveSuccess: vi.fn(),
        }),
      );
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
      expect(reloadMock).not.toHaveBeenCalled();
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
      expect(reloadMock).not.toHaveBeenCalled();
      expect(invalidateMock).toHaveBeenCalled();
    });
  });
});
