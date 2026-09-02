import { describe, expect, it } from "vitest";
import { PRODUCTS, productById, productFromPathname } from "../products";

describe("product registry", () => {
  describe("given the four products the registry declares", () => {
    describe("when the registry is read", () => {
      it("declares the four products in their fixed order", () => {
        expect(PRODUCTS.map((product) => product.id)).toEqual([
          "me",
          "llm-ops",
          "gateway",
          "governance",
        ]);
      });

      it("advertises function in every pitch", () => {
        expect(productById("me").pitch).toBe("Track your coding assistants");
        expect(productById("llm-ops").pitch).toBe(
          "Observe, evaluate and test your agents",
        );
        expect(productById("gateway").pitch).toBe("Route, meter and bill LLM usage");
        expect(productById("governance").pitch).toBe(
          "Every AI tool, license, agent and dollar",
        );
      });
    });
  });

  describe("when resolving a product home", () => {
    it("gives LLM Ops a home only once a project is known", () => {
      expect(productById("llm-ops").homeHref({ projectSlug: "demo" })).toBe("/demo");
      expect(productById("llm-ops").homeHref({ projectSlug: null })).toBeNull();
    });

    it("points the org and personal products at fixed homes", () => {
      expect(productById("me").homeHref({})).toBe("/me");
      expect(productById("gateway").homeHref({})).toBe("/gateway/virtual-keys");
      expect(productById("governance").homeHref({})).toBe("/governance");
    });
  });
});

describe("productFromPathname", () => {
  it("maps product pages to their product", () => {
    expect(productFromPathname("/me")).toBe("me");
    expect(productFromPathname("/me/configure")).toBe("me");
    expect(productFromPathname("/gateway")).toBe("gateway");
    expect(productFromPathname("/gateway/virtual-keys/vk_1")).toBe("gateway");
    expect(productFromPathname("/governance")).toBe("governance");
    expect(productFromPathname("/governance/departments")).toBe("governance");
    expect(productFromPathname("/my-project/analytics")).toBe("llm-ops");
    expect(productFromPathname("/[project]/messages")).toBe("llm-ops");
  });

  /** @scenario An ops page is never remembered as the last product */
  it("treats settings, ops and app plumbing as no product", () => {
    for (const pathname of [
      "/",
      "/settings",
      "/settings/members",
      "/ops",
      "/ops/backoffice/users",
      "/admin/anything",
      "/auth/signin",
      "/authorize",
      "/onboarding/welcome",
      "/invite/accept",
      "/share/abc",
      "/unsubscribe",
      "/cli/auth",
      "/mcp/authorize",
      "/@project/foo",
    ]) {
      expect(productFromPathname(pathname)).toBeNull();
    }
  });

  it("does not confuse a project whose slug starts like a product word", () => {
    expect(productFromPathname("/gateway-team-abc123/traces")).toBe("llm-ops");
    expect(productFromPathname("/mekong-xyz/analytics")).toBe("llm-ops");
  });
});
