/**
 * @vitest-environment jsdom
 *
 * The drawer labelled each credential with its raw env-var name and nothing
 * else, so a customer looking at "GEMINI_API_KEY" had to guess which of
 * Google's several key types was wanted — and a Google Cloud key scoped to
 * another API was rejected with no hint as to why. The registry has carried
 * a sentence for each credential all along; it just was not rendered.
 *
 * Covers @integration scenarios from
 * specs/model-providers/credential-validation.feature.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { modelProviderRegistry } from "../../../features/onboarding/regions/model-providers/registry";
import {
  keyedRow,
  makePrimeQueries,
  modelProviderDrawerMocks,
  resetModelProviderDrawerMocks,
  Wrapper,
} from "./modelProviderDrawerHarness";
import { EditModelProviderForm } from "../ModelProviderForm";

const {
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = modelProviderDrawerMocks;

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = (providerKey: string) =>
  render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={providerKey}
        modelProviderId={`row-${providerKey}`}
      />
    </Wrapper>,
  );

const geminiEntry = modelProviderRegistry.find(
  (entry) => entry.backendModelProviderKey === "gemini",
);

describe("Feature: the drawer says where each credential comes from", () => {
  beforeEach(() => {
    resetModelProviderDrawerMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a provider whose credential needs explaining", () => {
    describe("when the drawer is opened", () => {
      it("shows the guidance the registry carries for that field", () => {
        primeQueries([
          keyedRow({
            providerKey: "gemini",
            apiKey: "GEMINI_API_KEY",
            baseUrl: "GEMINI_BASE_URL",
          }),
        ]);
        renderDrawer("gemini");

        const description =
          geminiEntry?.fieldMetadata?.GEMINI_API_KEY?.description;
        expect(description).toBeTruthy();
        expect(screen.getByText(description!)).toBeInTheDocument();
      });
    });
  });

  /**
   * A Google Cloud key is commonly restricted to a single Google service,
   * and both kinds now belong on this one provider: validation detects
   * which door the key opens. The copy has to say an Agent Platform key is
   * welcome here — the old text sent those customers hunting for another
   * provider, which is exactly how a valid key came to read as invalid.
   * Pinned so it cannot quietly drift back to "your Gemini API key".
   */
  describe("given the customer holds a Google Cloud key", () => {
    describe("when they read the credential field", () => {
      it("says either kind of Google key belongs here", () => {
        const description =
          geminiEntry?.fieldMetadata?.GEMINI_API_KEY?.description ?? "";

        expect(description).toContain("AI Studio");
        expect(description).toContain("Gemini Enterprise Agent Platform");
      });
    });
  });
});
