/**
 * Whether the Data Privacy page reads the plan, and the license it reads from it.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { describe, expect, it } from "vitest";

import { licenceOf, mayReadPlan } from "../privacy-licence.ts";

describe("given the deployment and the reader", () => {
  /** @scenario The page reads the license only self-hosted, and only for a reader allowed to */
  it("reads the plan self-hosted, for a reader who may view the organization", () => {
    expect(mayReadPlan({ isSaaS: false, organizationId: "org-1", canViewOrganization: true })).toBe(
      true,
    );
  });

  it("never reads the plan on LangWatch Cloud", () => {
    expect(mayReadPlan({ isSaaS: true, organizationId: "org-1", canViewOrganization: true })).toBe(
      false,
    );
  });

  it("does not read the plan without an organization or the permission to view it", () => {
    expect(
      mayReadPlan({ isSaaS: false, organizationId: undefined, canViewOrganization: true }),
    ).toBe(false);
    expect(
      mayReadPlan({ isSaaS: false, organizationId: "org-1", canViewOrganization: false }),
    ).toBe(false);
  });
});

describe("given the plan read", () => {
  const answered = (type: string) => ({ isLoading: false, isError: false, data: { type } });

  it("reads an Enterprise plan as the license", () => {
    expect(licenceOf({ mayRead: true, plan: answered("ENTERPRISE") })).toBe("enterprise");
  });

  it("reads any other plan as no license", () => {
    expect(licenceOf({ mayRead: true, plan: answered("OPEN_SOURCE") })).toBe("none");
    expect(licenceOf({ mayRead: true, plan: answered("GROWTH") })).toBe("none");
  });

  it("is loading while the read is in flight", () => {
    expect(
      licenceOf({ mayRead: true, plan: { isLoading: true, isError: false, data: undefined } }),
    ).toBe("loading");
  });

  it("is unknown when the plan may not be read or the read failed", () => {
    expect(licenceOf({ mayRead: false, plan: answered("ENTERPRISE") })).toBe("unknown");
    expect(
      licenceOf({ mayRead: true, plan: { isLoading: false, isError: true, data: undefined } }),
    ).toBe("unknown");
  });

  it("is unknown when a refresh failed, even with an earlier answer still cached", () => {
    expect(licenceOf({ mayRead: true, plan: { ...answered("OPEN_SOURCE"), isError: true } })).toBe(
      "unknown",
    );
    expect(licenceOf({ mayRead: true, plan: { ...answered("ENTERPRISE"), isError: true } })).toBe(
      "unknown",
    );
  });
});
