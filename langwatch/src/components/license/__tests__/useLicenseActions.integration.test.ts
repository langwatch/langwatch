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

const { uploadMutationOptions, publicEnvData } = vi.hoisted(() => ({
  uploadMutationOptions: { current: null as null | Record<string, any> },
  publicEnvData: {
    current: undefined as undefined | { IS_SAAS: boolean },
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    license: {
      upload: {
        useMutation: (options: Record<string, any>) => {
          uploadMutationOptions.current = options;
          return { mutate: vi.fn(), isLoading: false };
        },
      },
      remove: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
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

describe("useLicenseActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMutationOptions.current = null;
    // jsdom's location.reload is a non-configurable no-op that reports
    // "Not implemented" to the virtual console — safe to let it run.
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
});
