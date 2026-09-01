/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsContent } from "../ui/sections/feature-flags-content";
import { renderWithOpsHost, fakeOpsHost } from "../../../testing";

/**
 * This page's copy is the only thing that tells an operator where a flag's
 * value comes from, and it drifted once already: PostHog left the resolver
 * without anyone editing the strings, so /ops/feature-flags spent months
 * telling SaaS operators their postgres edit was "an emergency override
 * only" when it was in fact the source of truth. An operator who believes
 * that does not write the row, and the rollout does not happen.
 *
 * These assertions are deliberately about meaning rather than wording: they
 * pin what the copy must still tell an operator — what a value set here
 * reaches, what outranks it, and in what order — and that it names no
 * external service. A future rewrite is free to say it better, but not free
 * to say the old thing again, and not free to drop a link in the chain.
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

vi.mock("../../../behavior/ops-session", () => ({
  useOpsPermission: () => ({ scope: { kind: "platform" } }),
}));

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: () => null,
  showErrorToast: vi.fn(),
}));

vi.mock("../../../behavior/ops-api", () => ({
  api: {
    useUtils: () => ({
      ops: { listFeatureFlags: { invalidate: vi.fn() } },
    }),
    ops: {
      listFeatureFlags: {
        useQuery: () => ({
          // `families` is not optional on the catalogue the view renders, and
          // the fixture omitted it: the row that lists dynamically named flags
          // reads `catalogue.families.length` unguarded, so every render in
          // this file threw before the page it is about was on screen. Repaired
          // rather than moved verbatim; the file asserts nothing about
          // families, so an empty list is the faithful reading.
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

      // Order is the assertion, not mere presence: the chain is env override,
      // then this store, then the registry default, and copy that lists them
      // in any other order teaches an operator the wrong precedence.
      //
      // Each link is matched loosely so that rewording the copy — "env" to
      // "environment variable", say — does not fail a test about ordering.
      // Only a reordered or missing link should turn this red.
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

      // The explanation used to live only in tooltip content, which Chakra
      // does not render until hover — so the whole note could be replaced
      // with "x" and this file stayed green. It is now screen-reader-only
      // text inside the badge, which puts it in the DOM for a screen reader
      // and for this assertion at the same time.
      //
      // Queried by text rather than by label on purpose: an aria-label on
      // Chakra's role-less <span> badge would satisfy getByLabelText while
      // being ignored by an actual screen reader, so a passing label query
      // would prove nothing about the claim this test exists to pin.
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
