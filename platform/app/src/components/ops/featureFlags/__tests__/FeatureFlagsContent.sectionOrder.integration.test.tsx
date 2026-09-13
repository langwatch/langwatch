/**
 * @vitest-environment jsdom
 *
 * Which section an operator lands on first.
 *
 * The page opens for a product rollout far more often than for an incident,
 * and the kill switches outnumber the product flags heavily — so leading with
 * System meant scrolling past every pipeline toggle to reach the flag you
 * came for. Order is not decoration here; it is the page's answer to "what is
 * this for".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsContent } from "../FeatureFlagsContent";

const FLAGS = [
  {
    key: "ops_es_trace_processing_killswitch",
    scope: "SYSTEM" as const,
    defaultValue: false,
    description: "Halts trace processing.",
    family: null,
    storedValue: null,
    rules: [],
    envOverride: null,
    effective: false,
    lastEditedBy: null,
    updatedAt: null,
  },
  {
    key: "release_ui_comparison_leaderboard_enabled",
    scope: "PRODUCT" as const,
    defaultValue: false,
    description: "Bradley-Terry leaderboard chart.",
    family: null,
    storedValue: null,
    rules: [],
    envOverride: null,
    effective: false,
    lastEditedBy: null,
    updatedAt: null,
  },
];

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ scope: { kind: "platform" } }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true } }),
}));

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: () => null,
  showErrorToast: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ ops: { listFeatureFlags: { invalidate: vi.fn() } } }),
    ops: {
      listFeatureFlags: {
        useQuery: () => ({
          data: { flags: FLAGS },
          isLoading: false,
          error: null,
        }),
      },
      setFeatureFlag: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      clearFeatureFlag: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      setFeatureFlagRules: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

afterEach(cleanup);

describe("given an operator opens the feature flags page", () => {
  /** @scenario "The page leads with the flags operators actually roll out" */
  it("shows the Product section before the System section", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <FeatureFlagsContent />
      </ChakraProvider>,
    );

    const product = screen.getByText("Product");
    const system = screen.getByText("System");

    // DOCUMENT_POSITION_FOLLOWING: `system` comes after `product` in the
    // document, which is the reading order on the page.
    expect(
      product.compareDocumentPosition(system) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
