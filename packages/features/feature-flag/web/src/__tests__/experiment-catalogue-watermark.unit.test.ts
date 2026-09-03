/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExperimentCatalogueWatermark } from "../experiment-catalogue-watermark";

const STORAGE_KEY = "langwatch:experiments-seen-version";

describe("useExperimentCatalogueWatermark", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("given experiments this browser has never seen", () => {
    it("reports them as unseen", () => {
      const { result } = renderHook(() => useExperimentCatalogueWatermark([1, 3]));

      expect(result.current.hasUnseen).toBe(true);
    });

    it("clears once the list has been opened", () => {
      const { result } = renderHook(() => useExperimentCatalogueWatermark([1, 3]));

      act(() => result.current.markSeen());

      expect(result.current.hasUnseen).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("3");
    });
  });

  describe("given the browser is caught up", () => {
    it("reports nothing unseen", () => {
      localStorage.setItem(STORAGE_KEY, "3");

      const { result } = renderHook(() => useExperimentCatalogueWatermark([1, 3]));

      expect(result.current.hasUnseen).toBe(false);
    });

    it("reports unseen again when a newer experiment appears", () => {
      localStorage.setItem(STORAGE_KEY, "3");

      const { result } = renderHook(() => useExperimentCatalogueWatermark([1, 3, 4]));

      expect(result.current.hasUnseen).toBe(true);
    });
  });

  describe("given no experiments are visible to this viewer", () => {
    it("shows no dot, so an invisible experiment cannot light it", () => {
      const { result } = renderHook(() => useExperimentCatalogueWatermark([]));

      expect(result.current.hasUnseen).toBe(false);
    });
  });

  describe("given storage cannot be read", () => {
    it("still renders and simply treats everything as unseen", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("site data blocked");
      });

      const { result } = renderHook(() => useExperimentCatalogueWatermark([2]));

      expect(result.current.hasUnseen).toBe(true);
    });
  });

  describe("given storage cannot be written", () => {
    it("leaves the dialog usable and may show the dot again", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      const { result } = renderHook(() => useExperimentCatalogueWatermark([2]));

      expect(() => act(() => result.current.markSeen())).not.toThrow();
    });
  });
});
