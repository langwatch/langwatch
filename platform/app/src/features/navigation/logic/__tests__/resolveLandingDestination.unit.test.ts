/**
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
import { describe, expect, it } from "vitest";
import type { ProductId } from "../../products";
import {
  type LandingDestinationInput,
  resolveLandingDestination,
} from "../resolveLandingDestination";

const ALL_PRODUCTS: readonly ProductId[] = [
  "me",
  "llm-ops",
  "gateway",
  "governance",
];

function input(
  overrides: Partial<LandingDestinationInput> = {},
): LandingDestinationInput {
  return {
    pinnedPath: null,
    rememberedProduct: null,
    reachableProducts: ALL_PRODUCTS,
    serverHomeDestination: null,
    projectSlug: null,
    ...overrides,
  };
}

describe("resolveLandingDestination", () => {
  describe("when the user pinned a home", () => {
    /** @scenario An explicit pin outranks everything */
    it("lands on the pin over any memory", () => {
      expect(
        resolveLandingDestination(
          input({
            pinnedPath: "/governance",
            rememberedProduct: "gateway",
            serverHomeDestination: "/demo",
          }),
        ),
      ).toBe("/governance");
    });
  });

  describe("when a product is remembered", () => {
    /** @scenario The remembered product outranks the organization intent */
    it("lands on the remembered product over the server intent", () => {
      expect(
        resolveLandingDestination(
          input({
            rememberedProduct: "gateway",
            serverHomeDestination: "/demo",
          }),
        ),
      ).toBe("/gateway/virtual-keys");
    });

    /** @scenario A remembered product I lost access to falls through */
    it("falls through when the product is not reachable anymore", () => {
      expect(
        resolveLandingDestination(
          input({
            rememberedProduct: "governance",
            reachableProducts: ["me", "llm-ops"],
            serverHomeDestination: "/me",
          }),
        ),
      ).toBe("/me");
    });

    /** @scenario A remembered LLM Ops without any project falls through */
    it("falls through when LLM Ops has no project to open", () => {
      expect(
        resolveLandingDestination(
          input({
            rememberedProduct: "llm-ops",
            projectSlug: null,
            serverHomeDestination: "/governance",
          }),
        ),
      ).toBe("/governance");
    });

    it("opens the last project when LLM Ops is remembered with one", () => {
      expect(
        resolveLandingDestination(
          input({
            rememberedProduct: "llm-ops",
            projectSlug: "demo",
            serverHomeDestination: "/governance",
          }),
        ),
      ).toBe("/demo");
    });
  });

  describe("when nothing is remembered", () => {
    /** @scenario A first visit follows the organization intent */
    it("follows the server home resolver", () => {
      expect(
        resolveLandingDestination(
          input({ serverHomeDestination: "/governance" }),
        ),
      ).toBe("/governance");
    });

    /** @scenario With nothing to go on the safety nets decide */
    it("falls back to the known project, then Me, then nothing", () => {
      expect(resolveLandingDestination(input({ projectSlug: "demo" }))).toBe(
        "/demo",
      );
      expect(
        resolveLandingDestination(input({ reachableProducts: ["me"] })),
      ).toBe("/me");
      expect(
        resolveLandingDestination(input({ reachableProducts: [] })),
      ).toBeNull();
    });
  });
});
