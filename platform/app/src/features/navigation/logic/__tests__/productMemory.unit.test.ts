/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-v2-product-memory.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readLastVisitedProduct,
  writeLastVisitedProduct,
} from "../productMemory";

beforeEach(() => {
  localStorage.clear();
});

describe("product memory", () => {
  describe("when a product page is visited", () => {
    /** @scenario Visiting a product page remembers that product for the organization */
    it("remembers the product for that organization", () => {
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe(
        "gateway",
      );
    });
  });

  describe("when two organizations are used", () => {
    /** @scenario Two organizations keep separate memories */
    it("keeps a separate memory per organization", () => {
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });
      writeLastVisitedProduct({
        organizationId: "org_2",
        productId: "governance",
      });

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe(
        "gateway",
      );
      expect(readLastVisitedProduct({ organizationId: "org_2" })).toBe(
        "governance",
      );
    });
  });

  describe("when the stored value is garbage", () => {
    /** @scenario Garbage in the memory reads as nothing */
    it("reads as nothing", () => {
      localStorage.setItem("langwatch:nav:last-product:org_1:v1", "banana");
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBeNull();
    });
  });

  describe("when the same product repeats", () => {
    /** @scenario Repeating the same product does not rewrite storage */
    it("does not write storage again", () => {
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });
      const setItem = vi.spyOn(Storage.prototype, "setItem");

      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });

      expect(setItem).not.toHaveBeenCalled();
      setItem.mockRestore();
    });
  });
});
