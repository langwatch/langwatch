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

const { uploadMutationOptions, isSaas } = vi.hoisted(() => ({
  uploadMutationOptions: { current: null as null | Record<string, any> },
  isSaas: { value: false },
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
  usePublicEnv: () => ({ data: { IS_SAAS: isSaas.value } }),
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
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    });
  });

  describe("when a license is activated on a self-hosted deployment", () => {
    /** @scenario Activating a license takes effect at the next restart */
    it("tells the admin a restart is required to enable SSO", () => {
      isSaas.value = false;

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
      isSaas.value = true;

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
});
