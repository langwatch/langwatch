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
 * Only the boundaries are mocked — the layout chrome, the plan, the feature
 * flag and the tRPC client. The permission decision is NOT: `hasAnyPermission`
 * runs the real role bag, so a grant missing from it fails these tests rather
 * than shipping a screen nobody can open.
 *
 * THE MOCKS LIVE HERE, WHICH IS A DIVERGENCE, AND IT IS PAID FOR.
 * The house rule is that `vi.mock` stays in each test file, because it has to
 * hoist above that file's own imports (`src/components/settings/__tests__/
 * modelProviderDrawerHarness.tsx` says so and keeps to it). Five suites here
 * would mean five copies of the ninety lines below, which is the duplication
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
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";
import {
  getOrganizationRolePermissions,
  hasPermissionWithHierarchy,
} from "~/server/api/rbac";

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

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(hoistedHarness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: true,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => {
  const mutation = () => ({
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      variables: undefined,
      data: undefined,
      error: null,
      reset: vi.fn(),
    }),
  });
  return {
    api: {
      useUtils: () => ({
        ingestionSources: { list: { invalidate: vi.fn() } },
        aiTools: {
          adminList: { invalidate: vi.fn(), setData: vi.fn() },
          list: { invalidate: vi.fn() },
        },
      }),
      ingestionSources: {
        list: { useQuery: () => hoistedHarness.sources },
        create: mutation(),
        update: mutation(),
        rotateSecret: mutation(),
        archive: mutation(),
        ottlStarter: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
        validateOttl: mutation(),
      },
      aiTools: {
        adminList: { useQuery: () => hoistedHarness.tools },
        setEnabled: mutation(),
        remove: mutation(),
        create: mutation(),
        update: mutation(),
        providerOptions: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
        routingPolicyOptions: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
      },
      departments: {
        list: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      },
    },
  };
});

import { AddIngestionSourceMenu } from "../../../../features/ingestion-sources/ui/elements/add-ingestion-source-menu.tsx";
import InventoryPage from "../governance-inventory.screen.tsx";
import { CONNECTED_SOURCES, REGISTERED_TOOLS } from "./inventoryFixtures";

/** The real org-admin bag, not a hand-written list that could drift from it. */
export const ORG_ADMIN_PERMISSIONS =
  getOrganizationRolePermissions("ADMIN").slice();

export function renderScreen({
  at = "/governance/inventory",
}: {
  /** The address to land on, for the suites that assert a deep link. */
  at?: string;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[at]}>
        <InventoryPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
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
      {/* Add tool is not a bare button: it is this menu's trigger, and the
          trigger composition adds a class and its own emitted style. Comparing
          it against a bare solid button fails on the wrapper rather than on
          the variant, which would be a false alarm. So the reference wears the
          same wrapper, and the comparison stays about the button. */}
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <Button size="sm" colorPalette="orange">
          reference solid small trigger
        </Button>
      </AddIngestionSourceMenu>
    </>
  );
}

export function renderScreenWithReferences() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance/inventory"]}>
        <InventoryPage />
        <ButtonReferences />
      </MemoryRouter>
    </ChakraProvider>,
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
export { findNativeSelects } from "~/components/governance/filters";
export { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";
export { CONNECTED_SOURCES, REGISTERED_TOOLS } from "./inventoryFixtures";
