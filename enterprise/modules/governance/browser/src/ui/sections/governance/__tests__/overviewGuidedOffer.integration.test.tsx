// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * What the governance overview tells the guided offer about governance being in use.
 * @see specs/home/guided-onboarding-offer.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  sources: { data: [] as unknown[] | undefined, isError: false },
}));

vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));
vi.mock("../../../../behavior/lent-hero-ask-field.tsx", () => ({
  HeroAskField: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
}));
vi.mock("../../../../behavior/lent-guided-onboarding-offer.tsx", () => ({
  GuidedOnboardingOffer: ({ space, spaceInUse }: { space: string; spaceInUse: boolean | null }) => (
    <p data-testid="guided-offer-probe">{`${space}:${String(spaceInUse)}`}</p>
  ),
}));
vi.mock("../../../../features/overview/ui/sections/quarantine-fill-panel.tsx", () => ({
  QuarantineFillAlert: () => null,
}));
vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const sources = path.join(".") === "ingestionSources.list";
            return () => ({
              data: sources ? harness.sources.data : undefined,
              isLoading: false,
              isFetching: false,
              isError: sources ? harness.sources.isError : false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property)) {
            return vi.fn();
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import GovernanceOverviewPage from "../governance-overview.screen.tsx";

const READER = ["governance:view", "activityMonitor:view", "ingestionSources:view"];

function renderOverview() {
  const host = FakeGovernanceHost.create({
    permissions: READER,
    enabledFlags: ["release_ui_ai_governance_enabled"],
  });
  renderWithGovernanceHost(<GovernanceOverviewPage />, { host });
}

const offer = () => screen.getByTestId("guided-offer-probe");

describe("the governance home's guided offer", () => {
  afterEach(() => cleanup());

  describe("given the sources failed to load over an empty list still in the cache", () => {
    /** @scenario a read that failed is not read as an empty space */
    it("tells the offer the space is unknown, so no pill shows", () => {
      harness.sources = { data: [], isError: true };
      renderOverview();
      expect(offer()).toHaveTextContent("governance:null");
    });
  });

  describe("given the sources answered with an empty list", () => {
    it("tells the offer governance is not in use", () => {
      harness.sources = { data: [], isError: false };
      renderOverview();
      expect(offer()).toHaveTextContent("governance:false");
    });
  });
});
