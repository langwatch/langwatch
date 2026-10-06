// @vitest-environment jsdom
/**
 * Governance draws onboarding's pill and model-provider's picker by token, and nothing where none
 * is lent: enterprise/modules/governance/specs/governance-lent-by-token.feature.
 */
import {
  UiCapabilityContextProvider,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { ModelSelectorToken } from "@langwatch/model-provider-contract";
import { GuidedOnboardingOfferToken } from "@langwatch/onboarding-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidedOnboardingOffer } from "../lent-guided-onboarding-offer.tsx";
import { ModelSelector } from "../lent-model-provider.tsx";

const peersLend = uiDeclarations([
  {
    name: "onboarding",
    installation: {
      capabilities: {},
      lends: [
        {
          token: GuidedOnboardingOfferToken,
          load: async () => ({
            default: ({ space }: { space: string }) => <button>Start guided {space}</button>,
          }),
        },
      ],
    },
  },
  {
    name: "model-provider",
    installation: {
      capabilities: {},
      lends: [
        {
          token: ModelSelectorToken,
          load: async () => ({
            default: ({ options }: { options: string[] }) => <p>Models {options.join(",")}</p>,
          }),
        },
      ],
    },
  },
]);

function renderPeers({ declarations }: { declarations: UiDeclarations }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations,
  };
  return render(
    <UiCapabilityContextProvider value={capabilities}>
      <div data-testid="screen">
        <GuidedOnboardingOffer space="governance" spaceInUse={false} />
        <ModelSelector model="gpt-5" options={["gpt-5", "gpt-5-mini"]} onChange={vi.fn()} />
      </div>
    </UiCapabilityContextProvider>,
  );
}

afterEach(cleanup);

describe("given governance's screens", () => {
  describe("when onboarding lends its pill", () => {
    /** @scenario The overview draws onboarding's lent guided onboarding pill */
    it("draws the pill with the space", async () => {
      renderPeers({ declarations: peersLend });

      expect(await screen.findByText("Start guided governance")).toBeDefined();
    });
  });

  describe("when model-provider lends its picker", () => {
    /** @scenario The insights setup drawer draws model-provider's lent model picker */
    it("draws the picker with the models", async () => {
      renderPeers({ declarations: peersLend });

      expect(await screen.findByText("Models gpt-5,gpt-5-mini")).toBeDefined();
    });
  });

  describe("when no module lends either", () => {
    /** @scenario No module lends a token governance reads */
    it("draws nothing in their place", () => {
      renderPeers({ declarations: uiDeclarations([]) });

      expect(screen.getByTestId("screen").textContent).toBe("");
    });
  });
});
