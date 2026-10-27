/**
 * @vitest-environment jsdom
 * Spec: specs/ops/internal-feature-flags.feature
 */
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../../testing.tsx";
import OpsFeatureFlagsScreen from "../ops-feature-flags.screen.tsx";

vi.mock("../../../../features/feature-flags/ui/sections/feature-flags-content.tsx", () => ({
  FeatureFlagsContent: () => <p>flags content</p>,
}));

describe("given the Ops Feature Flags page", () => {
  /** @scenario "Self-hosted installs do not offer the Feature Flags page" */
  it("answers as an unknown page without cloud ops", () => {
    renderWithOpsHost(<OpsFeatureFlagsScreen />, { host: fakeOpsHost({ cloudOps: false }) });

    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("flags content")).not.toBeInTheDocument();
  });

  it("renders with cloud ops", () => {
    renderWithOpsHost(<OpsFeatureFlagsScreen />, { host: fakeOpsHost({ cloudOps: true }) });

    expect(screen.getByText("flags content")).toBeInTheDocument();
  });
});
