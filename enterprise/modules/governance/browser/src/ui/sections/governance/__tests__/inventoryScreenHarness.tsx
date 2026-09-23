// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Inventory page's test harness: the mounted screen and everything the
 * suites around it agree to pretend.
 *
 * WHY THIS FILE EXISTS. The Inventory tests were one 837-line file carrying
 * five separate claims — the tab strip, the catalog cards, the environments
 * derivation, sample mode, and the section's shared UI rules — with the mocks
 * and fixtures inline above them. Nobody reads a file that long to find the
 * one assertion they broke. The claims are now one file each and the setup
 * they share is here, named once.
 *
 * Only the boundaries are mocked, and there is now one of them: the tRPC
 * client. The layout chrome, the feature flag, the plan and the address all
 * come from the governance host, which is a test double (`fakeGovernanceHost`)
 * rather than a mocked module. The permission decision is NOT stubbed either:
 * `hasAnyPermission` runs the real authz hierarchy rule, so a grant missing
 * from a fixture's bag fails these tests rather than shipping a screen nobody
 * can open.
 *
 * THE MOCK LIVES HERE, WHICH IS A DIVERGENCE, AND IT IS PAID FOR.
 * The house rule is that `vi.mock` stays in each test file, because it has to
 * hoist above that file's own imports (`src/components/settings/__tests__/
 * modelProviderDrawerHarness.tsx` says so and keeps to it). Five suites here
 * would mean five copies of the tRPC proxy below, which is the duplication
 * the split existed to remove, and it would put the largest suite back over
 * the size limit the split existed to satisfy.
 *
 * The rule guards against one thing: an import placed ABOVE the harness that
 * transitively reaches a mocked module would bind the real one, and the
 * failure would read as a missing tRPC provider rather than as an import
 * order. So this file re-exports everything the five suites need — see the
 * bottom — and none of them imports anything but this and the test libraries.
 * There is no line above the harness for the hazard to live on.
 *
 * The page is the right level for these assertions rather than the panes: two
 * of the rules under test — where the actions sit, and that no native select
 * is anywhere on screen — are claims about the whole screen, and a pane test
 * can see neither the header nor the drawers.
 *
 * Specs:
 *   - specs/ai-governance/dashboard/inventory-catalog.feature
 *   - specs/ai-governance/dashboard/inventory-environments.feature
 *   - specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { Button } from "@chakra-ui/react";
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  fakeGovernanceHost,
  renderWithGovernanceHost,
  type GovernanceQuery,
} from "../../../../testing.tsx";
import { SAMPLE_CHOICE_KEY } from "../../../../ui/elements/governance-sample-mode.ts";

const hoistedHarness = vi.hoisted(() => ({
  permissions: [] as string[],
  /** What `ingestionSources.list` answers. */
  sources: {
    data: undefined as unknown,
    isLoading: false,
    error: null as unknown,
  },
  /** What `aiTools.adminList` answers — the organization's tool registry. */
  tools: {
    data: undefined as unknown,
    isLoading: false,
    error: null as unknown,
  },
}));

/**
 * Re-exported as a plain binding: vitest refuses to export the hoisted
 * declaration itself, and every suite needs to reach the permission bag.
 */
export const harness = hoistedHarness;

vi.mock("../../../../behavior/governance-api.ts", () => {
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
    data: undefined,
    error: null,
    reset: vi.fn(),
  });
  const defaultQueryResult = () => ({ data: undefined, isLoading: false, error: null });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const full = path.join(".");
            if (full === "ingestionSources.list") return () => hoistedHarness.sources;
            if (full === "aiTools.adminList") return () => hoistedHarness.tools;
            return () => defaultQueryResult();
          }
          if (property === "useMutation") return mutationResult;
          // The utils client's imperative methods are called, not walked, so
          // they have to be functions rather than another proxy node.
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property))
            return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  const api = node([]);
  return { api, governanceApi: api };
});

import { AddIngestionSourceMenu } from "../../../../features/ingestion-sources/ui/elements/add-ingestion-source-menu.tsx";
import InventoryPage from "../governance-inventory.screen.tsx";
import { CONNECTED_SOURCES, REGISTERED_TOOLS } from "./inventoryFixtures";

/** The real org-admin bag, not a hand-written list that could drift from it. */
export const ORG_ADMIN_PERMISSIONS = [
  ...builtinRolePermissions("org-admin"),
  ...builtinRolePermissions("admin"),
];

/** The address, as a query string, that a deep-linked render opens on. */
function queryFrom(at: string | undefined): GovernanceQuery {
  const query: Record<string, string> = {};
  if (!at?.includes("?")) return query;
  const search = at.slice(at.indexOf("?") + 1);
  for (const [key, value] of new URLSearchParams(search)) {
    query[key] = value;
  }
  return query;
}

export function renderScreen({
  at,
}: {
  /** The address to land on, for the suites that assert a deep link. */
  at?: string;
} = {}) {
  const host = fakeGovernanceHost({
    permissions: hoistedHarness.permissions,
    query: queryFrom(at),
  });
  return renderWithGovernanceHost(<InventoryPage />, { host });
}

/**
 * Buttons of known variant and size, rendered beside the page so the header's
 * real buttons can be compared against them.
 *
 * Chakra emits an opaque hashed class name, so there is no readable "solid" to
 * assert on. Hard-coding the hash would pass today and break on the next
 * Chakra bump for no reason anyone could diagnose. Rendering a reference of a
 * known variant and comparing class names asserts the thing the rule is about
 * and survives the bump.
 *
 * The solid reference carries the section's orange rather than a plain solid,
 * which is grey. Comparing against grey would let this page drift away from
 * the rest of the section while still reporting green.
 */
function ButtonReferences() {
  return (
    <>
      <Button size="sm" variant="outline">
        reference outline small
      </Button>
      <Button size="sm" variant="ghost">
        reference ghost small
      </Button>
      {/* Branded, like the solid reference and for the same reason: the kit
          draws the pressed toggle `subtle` in orange, and the palette is part
          of the class Chakra emits, so a bare subtle reference never matches. */}
      <Button size="sm" variant="subtle" colorPalette="orange">
        reference subtle small
      </Button>
      <Button size="sm" colorPalette="orange">
        reference solid small
      </Button>
      {/* Add source is not a bare button: it is this menu's trigger, and the
          trigger composition adds a class and its own emitted style, so the
          references wear the same wrapper and the comparison stays about the button. */}
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <Button size="sm" variant="outline">
          reference outline small trigger
        </Button>
      </AddIngestionSourceMenu>
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <Button size="sm" colorPalette="orange">
          reference solid small trigger
        </Button>
      </AddIngestionSourceMenu>
    </>
  );
}

export function renderScreenWithReferences() {
  const host = fakeGovernanceHost({ permissions: hoistedHarness.permissions });
  return renderWithGovernanceHost(
    <>
      <InventoryPage />
      <ButtonReferences />
    </>,
    { host },
  );
}

/**
 * Switch panes and wait for the switch to land.
 *
 * The selected tab lives in the address (`?tab=`), so picking one is a
 * navigation, and react-router runs navigations inside a transition.
 * `userEvent.click` flushes its own act() but not the deferred transition, so
 * a synchronous query straight after the click reads the OLD pane and reports
 * a working tab strip as broken. Waiting for the tab to report itself selected
 * keeps these tests about the page rather than about React's scheduler.
 */
export async function openTab(name: RegExp) {
  const tab = screen.getByRole("tab", { name });
  await userEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
}

beforeEach(() => {
  hoistedHarness.permissions = ORG_ADMIN_PERMISSIONS;
  hoistedHarness.sources = { data: [], isLoading: false, error: null };
  hoistedHarness.tools = { data: [], isLoading: false, error: null };
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * An organization with no tools, with the sample choice pinned off.
 *
 * The pin is belt-and-braces, not a correction: `useSampleMode` reads
 * `optIn ?? false`, so an unset choice already means the reader's own data,
 * empty included. Setting it outright says which of the two states a test
 * meant, and keeps the empty-pane suites standing if that default is ever
 * flipped to offer samples to an empty org.
 *
 * This is the reader looking at their actual, empty catalog.
 */
export function emptyWithSamplesOff() {
  hoistedHarness.sources = { data: [], isLoading: false, error: null };
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
}

/**
 * The screen with two sources connected and three tools registered, so sample
 * mode stays off by itself.
 *
 * The two lists are deliberately unrelated. A source is not a tool, no card is
 * derived from one, and a fixture where the two lined up would let a test pass
 * against the exact confusion the catalog was rebuilt to remove.
 */
export function connectTools() {
  hoistedHarness.sources = {
    data: CONNECTED_SOURCES,
    isLoading: false,
    error: null,
  };
  hoistedHarness.tools = {
    data: REGISTERED_TOOLS,
    isLoading: false,
    error: null,
  };
}

/*
 * Re-exported so no suite has to import them itself. Every import a suite
 * writes above this one is a chance to bind a module before the mocks above
 * register; giving the suites a single door removes the chance rather than
 * documenting it.
 */
export { findNativeSelects } from "../../../../testing.tsx";
export { SAMPLE_CHOICE_KEY } from "../../../../ui/elements/governance-sample-mode.ts";
export { CONNECTED_SOURCES, REGISTERED_TOOLS } from "./inventoryFixtures";
