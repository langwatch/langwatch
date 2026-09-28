import { describe, expect, it } from "vitest";

import { PRODUCTS, productById, productFromPathname } from "../products.ts";

describe("product registry", () => {
  describe("given the five products the registry declares", () => {
    describe("when the registry is read", () => {
      it("declares the five products in their fixed order", () => {
        expect(PRODUCTS.map((product) => product.id)).toEqual([
          "me",
          "llm-ops",
          "dashboards",
          "gateway",
          "governance",
        ]);
      });

      it("advertises function in every pitch", () => {
        expect(productById("me").pitch).toBe("Track your coding assistants");
        expect(productById("llm-ops").pitch).toBe("Observe, evaluate and test your agents");
        expect(productById("dashboards").pitch).toBe("Your saved dashboards, in one place");
        expect(productById("gateway").pitch).toBe("Route, meter and bill LLM usage");
        expect(productById("governance").pitch).toBe("Every AI tool, license, agent and dollar");
      });
    });
  });

  describe("when resolving a product home", () => {
    it("gives LLM Ops a home only once a project is known", () => {
      expect(productById("llm-ops").homeHref({ projectSlug: "demo" })).toBe("/demo");
      expect(productById("llm-ops").homeHref({ projectSlug: null })).toBeNull();
    });

    it("gives Dashboards the project's Dashboards area once a project is known", () => {
      expect(productById("dashboards").homeHref({ projectSlug: "demo" })).toBe("/demo/dashboards");
      expect(productById("dashboards").homeHref({ projectSlug: null })).toBeNull();
    });

    /** @scenario "AC1 Flag off hides the area" */
    it("gates Dashboards on its release flag and analytics:view", () => {
      expect(productById("dashboards").gates).toEqual([
        { flag: "release_dashboards" },
        { permission: "analytics:view" },
      ]);
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

  it("maps a project's Dashboards area to the Dashboards product", () => {
    expect(productFromPathname("/my-project/dashboards")).toBe("dashboards");
    expect(productFromPathname("/my-project/dashboards/agent-flight-deck")).toBe("dashboards");
    expect(productFromPathname("/[project]/dashboards")).toBe("dashboards");
    expect(productFromPathname("/[project]/dashboards/board_1")).toBe("dashboards");
  });

  it("keeps every other project page in LLM Ops", () => {
    expect(productFromPathname("/my-project")).toBe("llm-ops");
    expect(productFromPathname("/my-project/analytics/dashboards")).toBe("llm-ops");
    expect(productFromPathname("/my-project/dashboards-old")).toBe("llm-ops");
    expect(productFromPathname("/dashboards")).toBe("llm-ops");
  });

  /** @scenario An ops page is never remembered as the last product */
  it("treats settings, ops and app plumbing as no product", () => {
    for (const pathname of [
      "/",
      "/settings",
      "/settings/members",
      "/ops",
      "/ops/users",
      "/ops/cloud/licenses",
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
