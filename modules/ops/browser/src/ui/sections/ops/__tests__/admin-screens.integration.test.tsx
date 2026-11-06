/**
 * @vitest-environment jsdom
 * Cloud admin without cloud ops answers as an unknown page and never mounts its view (§3.5).
 */
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../../testing.tsx";
import { CloudCouponsScreen, CloudLicensesScreen } from "../admin-screens.tsx";

vi.mock("../../../../features/admin/ui/sections/licenses-view.tsx", () => ({
  default: () => <p>licenses view</p>,
}));

// Billing lends the coupons page body; the screen only decides whether it is shown.
vi.mock("@langwatch/browser-host/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Lent: () => <p>coupons page</p>,
}));

describe("given the Cloud admin licenses page", () => {
  it("renders the page with cloud ops", () => {
    renderWithOpsHost(<CloudLicensesScreen />, { host: fakeOpsHost({ cloudOps: true }) });

    expect(screen.getByText("licenses view")).toBeInTheDocument();
  });

  it("answers as an unknown page without cloud ops", () => {
    renderWithOpsHost(<CloudLicensesScreen />, { host: fakeOpsHost({ cloudOps: false }) });

    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("licenses view")).not.toBeInTheDocument();
  });
});

describe("given the Cloud admin coupons page", () => {
  it("renders the page billing lends with cloud ops", () => {
    renderWithOpsHost(<CloudCouponsScreen />, { host: fakeOpsHost({ cloudOps: true }) });

    expect(screen.getByText("coupons page")).toBeInTheDocument();
  });

  /** @scenario "The page answers not found off LangWatch Cloud" */
  it("answers as an unknown page without cloud ops", () => {
    renderWithOpsHost(<CloudCouponsScreen />, { host: fakeOpsHost({ cloudOps: false }) });

    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("coupons page")).not.toBeInTheDocument();
  });
});
