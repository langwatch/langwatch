/**
 * Which board a Dashboards address opens, so the shell can draw the board's home product.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import {
  curatedBoardHomeProduct,
  isOrganizationCuratedPath,
  openBoardIdAt,
  organizationCuratedTemplateId,
} from "../open-board.ts";

describe("openBoardIdAt", () => {
  it.each([
    { pathname: "/dashboards/board_1", id: "board_1" },
    { pathname: "/dashboards/board_1/", id: "board_1" },
    { pathname: "/shop/dashboards/board_1", id: "board_1" },
  ])("reads the board id of $pathname", ({ pathname, id }) => {
    expect(openBoardIdAt(pathname)).toBe(id);
  });

  it.each([
    "/dashboards",
    "/dashboards/templates",
    "/dashboards/curated/release",
    "/shop/dashboards",
    "/shop/dashboards/templates",
    "/shop/dashboards/curated/release",
    "/shop/traces/abc",
    "/gateway/virtual-keys",
  ])("names no board at %s", (pathname) => {
    expect(openBoardIdAt(pathname)).toBeNull();
  });
});

describe("isOrganizationCuratedPath", () => {
  it("knows a From LangWatch board at the organization level from one in a project", () => {
    expect(isOrganizationCuratedPath("/dashboards/curated/release")).toBe(true);
    expect(isOrganizationCuratedPath("/shop/dashboards/curated/release")).toBe(false);
  });
});

describe("organizationCuratedTemplateId", () => {
  it.each([
    { pathname: "/dashboards/curated/release", id: "release" },
    { pathname: "/dashboards/curated/gateway-costs/", id: "gateway-costs" },
    { pathname: "/dashboards/curated/coding%2Dcosts", id: "coding-costs" },
  ])("reads the template id of $pathname", ({ pathname, id }) => {
    expect(organizationCuratedTemplateId(pathname)).toBe(id);
  });

  it.each([
    "/dashboards/curated",
    "/dashboards/curated/release/extra",
    "/dashboards/curated/%E0%A4%A",
    "/shop/dashboards/curated/gateway-costs",
    "/dashboards/board_1",
  ])("names no template at %s", (pathname) => {
    expect(organizationCuratedTemplateId(pathname)).toBeNull();
  });
});

describe("curatedBoardHomeProduct", () => {
  /** @scenario A product's pinned board opens inside that product */
  it("opens gateway-costs in the gateway", () => {
    expect(curatedBoardHomeProduct("gateway-costs")).toBe("gateway");
  });

  /** @scenario A product's pinned board opens inside that product */
  it("opens coding-costs in Me, the Coding agents product", () => {
    expect(curatedBoardHomeProduct("coding-costs")).toBe("me");
  });

  /** @scenario A product's pinned board opens inside that product */
  it("opens a board not pinned to a product in LLM Ops", () => {
    expect(curatedBoardHomeProduct("release")).toBe("llm-ops");
  });

  /** @scenario A product's pinned board opens inside that product */
  it("opens an unknown or prototype-named id in LLM Ops", () => {
    expect(curatedBoardHomeProduct("constructor")).toBe("llm-ops");
    expect(curatedBoardHomeProduct("")).toBe("llm-ops");
  });

  /** @scenario A product's pinned board opens inside that product */
  it("opens an encoded id that decodes to no pinned board in LLM Ops", () => {
    const templateId = organizationCuratedTemplateId("/dashboards/curated/coding%20costs") ?? "";
    expect(curatedBoardHomeProduct(templateId)).toBe("llm-ops");
  });
});
