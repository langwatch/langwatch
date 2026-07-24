/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { api } from "../../utils/api";
import { useModelProvidersSettings } from "../useModelProvidersSettings";

const mockUseQuery = vi.mocked(
  api.modelProvider.getAllForProjectForFrontend.useQuery
);

describe("useModelProvidersSettings()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasEnabledProviders", () => {
    describe("when loading", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: undefined,
          isLoading: true,
          refetch: vi.fn(),
        } as any);
      });

      it("returns true (optimistic default)", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" })
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });

    describe("when providers is undefined", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: undefined,
          isLoading: false,
          refetch: vi.fn(),
        } as any);
      });

      it("returns true (optimistic default)", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" })
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });

    describe("when no providers are configured", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: { providers: {}, modelMetadata: {} },
          isLoading: false,
          refetch: vi.fn(),
        } as any);
      });

      it("returns false", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" })
        );

        expect(result.current.hasEnabledProviders).toBe(false);
      });
    });

    describe("when all providers are disabled", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: {
            providers: {
              openai: { enabled: false, provider: "openai" },
              anthropic: { enabled: false, provider: "anthropic" },
            },
            modelMetadata: {},
          },
          isLoading: false,
          refetch: vi.fn(),
        } as any);
      });

      it("returns false", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" })
        );

        expect(result.current.hasEnabledProviders).toBe(false);
      });
    });

    describe("when at least one provider is enabled", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: {
            providers: {
              openai: { enabled: true, provider: "openai" },
              anthropic: { enabled: false, provider: "anthropic" },
            },
            modelMetadata: {},
          },
          isLoading: false,
          refetch: vi.fn(),
        } as any);
      });

      it("returns true", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" })
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });
  });
});
