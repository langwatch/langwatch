/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsContent } from "../ui/sections/feature-flags-content.tsx";
import { renderWithOpsHost, fakeOpsHost } from "../../../testing.tsx";

/** Copy is the only source of truth on where values come from (drifted when PostHog
 * left). Assertions pin meaning not wording; no external service names. */

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

vi.mock("../../../behavior/ops-session.ts", () => ({
  useOpsPermission: () => ({ scope: { kind: "platform" } }),
}));

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: () => null,
  showErrorToast: vi.fn(),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({
      ops: { listFeatureFlags: { invalidate: vi.fn() } },
    }),
    ops: {
      listFeatureFlags: {
        useQuery: () => ({
          // families required (code reads unguarded); omitted in fixture so add empty list.
          data: { flags: FLAGS, families: [] },
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
  isSaas.mockReturnValue(true);
});

function renderPage() {
  return renderWithOpsHost(<FeatureFlagsContent />, {
    host: fakeOpsHost({ sharedInstall: isSaas() }),
  });
}

/** Every external flag-service name that the removed resolver used to imply.
 *  Kept as a list so adding a future vendor to the copy trips this too. */
const EXTERNAL_FLAG_SERVICES = [/posthog/i, /launchdarkly/i, /split\.io/i];

/** Section's own description (not whole section); isolates test from historical
 * fixture data. */
function sectionDescription(heading: string): string {
  return screen.getByText(heading).nextElementSibling?.textContent ?? "";
}

describe("the Ops feature flags page", () => {
  describe("when an operator on a shared install reads the Product section", () => {
    /** @scenario The Product section tells operators what the value they set actually reaches */
    it("is told what this value reaches, and the two things that outrank it", () => {
      renderPage();

      const copy = sectionDescription("Product");

      // The claim itself, then the two caveats. Asserting only the caveats
      // would let the sentence they qualify be deleted.
      expect(copy).toMatch(/customers get the value set here/i);

      // Naming the store is not enough on its own: the resolver returns an
      // env override before it ever reads this store, and a targeting rule
      // before it reads the row-level value. Copy that claims "source of
      // truth" without either caveat is wrong for any flag that has one.
      expect(copy).toMatch(/no targeting rule matches/i);
      expect(copy).toMatch(/env override/i);

      for (const vendor of EXTERNAL_FLAG_SERVICES) {
        expect(copy).not.toMatch(vendor);
      }
    });
  });

  describe("when the same operator reads the System section", () => {
    /** @scenario The System section names the same chain, so the two cannot disagree */
    it("is given the same resolution chain, in the order the resolver uses", () => {
      renderPage();

      const copy = sectionDescription("System");

      // Order is the assertion (not presence); chain: env→store→registry default.
      // Links matched loosely so rewording doesn't fail; only reordering/missing matter.
      const positionOf = (link: string, pattern: RegExp) => {
        const at = copy.search(pattern);
        expect(at, `System copy never mentions ${link}: "${copy}"`).toBeGreaterThanOrEqual(0);
        return at;
      };

      const env = positionOf("the env override", /\benv(ironment)?\b/i);
      const store = positionOf("this postgres store", /postgres/i);
      const fallback = positionOf("the registry default", /registry default/i);

      expect(
        store,
        `System copy puts this store before the env override: "${copy}"`,
      ).toBeGreaterThan(env);
      expect(
        fallback,
        `System copy puts the registry default before this store: "${copy}"`,
      ).toBeGreaterThan(store);

      for (const vendor of EXTERNAL_FLAG_SERVICES) {
        expect(copy).not.toMatch(vendor);
      }
    });
  });

  describe("when a PRODUCT flag row is shown on a shared install", () => {
    /** @scenario Ops page warns about the blast radius of a PRODUCT flag on a shared install */
    it("carries a fleet-reach warning that explains itself without a hover", () => {
      renderPage();

      expect(screen.getByText("All customers")).toBeDefined();

      // Explanation now in badge (screen-reader-only, not just hover tooltip).
      // Query by text not label (aria-label on role-less span would pass but screen
      // readers ignore).
      const note = screen.getByText(/whole fleet/i).textContent ?? "";

      expect(note).toMatch(/no targeting rule matches/i);
      expect(note).toMatch(/per-organization or per-project rule/i);

      cleanup();
      isSaas.mockReturnValue(false);
      renderPage();

      expect(screen.queryByText("All customers")).toBeNull();
      expect(screen.queryByText(/whole fleet/i)).toBeNull();
    });
  });
});
