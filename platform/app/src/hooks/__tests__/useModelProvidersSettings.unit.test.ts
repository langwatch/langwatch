/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: mockUseQuery,
      },
    },
  },
}));

import { useModelProvidersSettings } from "../useModelProvidersSettings";

describe("useModelProvidersSettings()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasEnabledProviders", () => {
    describe("when loading", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: void 0,
          isLoading: true,
          refetch: vi.fn(),
        });
      });

      it("returns true (optimistic default)", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" }),
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });

    describe("when providers is undefined", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: void 0,
          isLoading: false,
          refetch: vi.fn(),
        });
      });

      it("returns true (optimistic default)", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" }),
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });

    describe("when no providers are configured", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: {},
          isLoading: false,
          refetch: vi.fn(),
        });
      });

      it("returns false", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" }),
        );

        expect(result.current.hasEnabledProviders).toBe(false);
      });
    });

    describe("when all providers are disabled", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: {
            openai: { enabled: false, provider: "openai" },
            anthropic: { enabled: false, provider: "anthropic" },
          },
          isLoading: false,
          refetch: vi.fn(),
        });
      });

      it("returns false", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" }),
        );

        expect(result.current.hasEnabledProviders).toBe(false);
      });
    });

    describe("when at least one provider is enabled", () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: {
            openai: { enabled: true, provider: "openai" },
            anthropic: { enabled: false, provider: "anthropic" },
          },
          isLoading: false,
          refetch: vi.fn(),
        });
      });

      it("returns true", () => {
        const { result } = renderHook(() =>
          useModelProvidersSettings({ projectId: "project-123" }),
        );

        expect(result.current.hasEnabledProviders).toBe(true);
      });
    });
  });
});
