import { PRODUCT_NAMES } from "@langwatch/design-system/product-colours";
import { describe, expect, it } from "vitest";

import {
  isEntityAddressedDetourRoute,
  isOrganizationDashboardsPath,
  isOrganizationLibraryPath,
  PRODUCTS,
  productById,
  productFromPathname,
  seatReachesProduct,
} from "../products.ts";

describe("product registry", () => {
  describe("given the five products the registry declares", () => {
    describe("when the registry is read", () => {
      /** @scenario Dashboards leads the product switcher */
      it("declares the five products in their fixed order, Dashboards first", () => {
        expect(PRODUCTS.map((product) => product.id)).toEqual([
          "dashboards",
          "me",
          "llm-ops",
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
    it("gates Dashboards on its release flag, which closes its pages, and analytics:view", () => {
      expect(productById("dashboards").gates).toEqual([
        { flag: "release_dashboards", closesPages: true },
        { permission: "analytics:view" },
      ]);
    });

    /** @scenario The product switcher names the personal workspace Coding agents */
    it("labels the personal product Coding agents", () => {
      expect(productById("me").label).toBe("Coding agents");
    });

    /** @scenario The product switcher names the personal workspace Coding agents */
    it("points the org and personal products at fixed homes", () => {
      expect(productById("me").homeHref({})).toBe("/coding-agents");
      expect(productById("gateway").homeHref({})).toBe("/gateway/virtual-keys");
      expect(productById("governance").homeHref({})).toBe("/governance");
    });
  });
});

describe("productFromPathname", () => {
  it("maps product pages to their product", () => {
    expect(productFromPathname("/coding-agents")).toBe("me");
    expect(productFromPathname("/coding-agents/configure")).toBe("me");
    // The retired address, for the one render its redirect takes.
    expect(productFromPathname("/me")).toBe("me");
    expect(productFromPathname("/me/sessions")).toBe("me");
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
  });

  it("maps the organization's Dashboards area to the Dashboards product", () => {
    expect(productFromPathname("/dashboards")).toBe("dashboards");
    expect(productFromPathname("/dashboards/")).toBe("dashboards");
    expect(productFromPathname("/dashboards/board_1")).toBe("dashboards");
    expect(productFromPathname("/dashboards/templates")).toBe("dashboards");
    expect(productFromPathname("/dashboards/curated/agent-flight-deck")).toBe("dashboards");
    expect(productFromPathname("/dashboards-old")).toBe("llm-ops");
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

  describe("given the seat the reader holds", () => {
    describe("when the reader is a Developer", () => {
      /** @scenario A Developer is offered the Me product and nothing organisation-wide */
      it("reaches the personal and project products and no organization-wide one", () => {
        const reaches = (id: Parameters<typeof productById>[0]) =>
          seatReachesProduct({
            product: productById(id),
            organizationRole: "DEVELOPER",
          });
        expect(reaches("me")).toBe(true);
        expect(reaches("llm-ops")).toBe(true);
        expect(reaches("gateway")).toBe(false);
        expect(reaches("governance")).toBe(false);
      });
    });

    describe("when the reader holds any other seat, or none is known yet", () => {
      it("leaves every product to its own gates", () => {
        for (const organizationRole of ["ADMIN", "MEMBER", "EXTERNAL", undefined] as const) {
          for (const product of PRODUCTS) {
            expect(seatReachesProduct({ product, organizationRole })).toBe(true);
          }
        }
      });
    });
  });
});

describe("the organization's Dashboards addresses", () => {
  describe("given an address with trailing slashes", () => {
    it("trims them, so the library and its area match however many there are", () => {
      expect({
        library: isOrganizationLibraryPath("/dashboards///"),
        inArea: isOrganizationDashboardsPath("/dashboards///"),
      }).toEqual({ library: true, inArea: true });
    });

    it("trims the root to nothing, which is neither the library nor in its area", () => {
      expect({
        library: isOrganizationLibraryPath("/"),
        inArea: isOrganizationDashboardsPath("/"),
      }).toEqual({ library: false, inArea: false });
    });
  });

  describe("given a project that still holds the slug dashboards", () => {
    /** @scenario A project still holding the dashboards slug keeps its deeper pages */
    it("reads an address below the area's own as that project's page", () => {
      expect({
        inArea: isOrganizationDashboardsPath("/dashboards/messages/trace_1"),
        product: productFromPathname("/dashboards/messages/trace_1"),
      }).toEqual({ inArea: false, product: "llm-ops" });
    });

    /** @scenario A project still holding the dashboards slug keeps its deeper pages */
    it("reads a board of that project as its own Dashboards area, not the organization's", () => {
      expect({
        inArea: isOrganizationDashboardsPath("/dashboards/dashboards/board_1"),
        product: productFromPathname("/dashboards/dashboards/board_1"),
      }).toEqual({ inArea: false, product: "dashboards" });
    });

    it("keeps the area's own addresses the organization's", () => {
      const areaAddresses = [
        "/dashboards",
        "/dashboards/board_1",
        "/dashboards/templates",
        "/dashboards/curated/agent-flight-deck",
      ];
      expect(areaAddresses.filter((pathname) => !isOrganizationDashboardsPath(pathname))).toEqual(
        [],
      );
    });
  });
});

describe("detour addresses that name an entity", () => {
  describe("given an address that names one organization's team", () => {
    it("reports it as entity-addressed, since the next organization has no such team", () => {
      expect(isEntityAddressedDetourRoute("/settings/teams/acme-core")).toBe(true);
    });
  });

  describe("given a detour address that names no organization entity", () => {
    it("reports it as portable, including the team list and the instance pages", () => {
      for (const pathname of [
        "/settings",
        "/settings/members",
        "/settings/teams",
        "/ops",
        "/ops/projections/run_17",
      ]) {
        expect(isEntityAddressedDetourRoute(pathname)).toBe(false);
      }
    });
  });
});

describe("product accent map", () => {
  describe("given the registry and the design system's colour map", () => {
    /** @scenario "Every registered product has an accent assignment and no other does" */
    it("names exactly the same products in both directions", () => {
      const registered = PRODUCTS.map((product) => product.id).toSorted();
      expect(PRODUCT_NAMES.toSorted()).toEqual(registered);
    });
  });
});
