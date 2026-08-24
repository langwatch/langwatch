/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsContent } from "../FeatureFlagsContent";

/**
 * This page's copy is the only thing that tells an operator where a flag's
 * value comes from, and it drifted once already: PostHog left the resolver
 * without anyone editing the strings, so /ops/feature-flags spent months
 * telling SaaS operators their postgres edit was "an emergency override
 * only" when it was in fact the source of truth. An operator who believes
 * that does not write the row, and the rollout does not happen.
 *
 * These assertions are deliberately about meaning rather than wording: they
 * pin that the SaaS Product copy claims this store as the source of truth
 * and names no external service, so a future rewrite is free to say it
 * better but not free to say the old thing again.
 */

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

const isSaas = vi.fn(() => true);

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ scope: { kind: "platform" } }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: isSaas() } }),
}));

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: () => null,
  showErrorToast: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      ops: { listFeatureFlags: { invalidate: vi.fn() } },
    }),
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
      // Each row mounts the targeting-rules dialog, which reaches for this.
      setFeatureFlagRules: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  isSaas.mockReturnValue(true);
});

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FeatureFlagsContent />
    </ChakraProvider>,
  );
}

/** Every external flag-service name that the removed resolver used to imply.
 *  Kept as a list so adding a future vendor to the copy trips this too. */
const EXTERNAL_FLAG_SERVICES = [/posthog/i, /launchdarkly/i, /split\.io/i];

/**
 * The section's own description, not the whole section: several registry
 * entries still name the removed service in their historical descriptions,
 * and those render inside this same box. Reading the sibling of the heading
 * keeps the assertion on the copy this test is about, so a fixture that
 * quotes a real description cannot fail it for the wrong reason.
 */
function sectionDescription(heading: string): string {
  return screen.getByText(heading).nextElementSibling?.textContent ?? "";
}

describe("the Ops feature flags page", () => {
  describe("when an operator on a shared install reads the Product section", () => {
    it("is told this store decides the value, not an outside service", () => {
      renderPage();

      const copy = sectionDescription("Product");

      expect(copy).toMatch(/source of truth/i);
      for (const vendor of EXTERNAL_FLAG_SERVICES) {
        expect(copy).not.toMatch(vendor);
      }
    });

    it("is told the same about the System section, so the two cannot disagree", () => {
      renderPage();

      const copy = sectionDescription("System");

      for (const vendor of EXTERNAL_FLAG_SERVICES) {
        expect(copy).not.toMatch(vendor);
      }
    });
  });

  describe("when a PRODUCT flag row is shown on a shared install", () => {
    /** @scenario Ops page warns about the blast radius of a PRODUCT flag on a shared install */
    it("carries the fleet-reach warning that a self-hosted install does not", () => {
      renderPage();
      expect(screen.getByText("All customers")).toBeDefined();

      cleanup();
      isSaas.mockReturnValue(false);
      renderPage();
      expect(screen.queryByText("All customers")).toBeNull();
    });
  });
});
