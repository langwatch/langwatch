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
 * THE MOCKS LIVE HERE, WHICH PUTS ONE OBLIGATION ON EVERY SUITE THAT IMPORTS
 * IT: nothing imported above this module may reach a module mocked below.
 * `vi.mock` is hoisted within the file that writes it, so these registrations
 * happen when this module is evaluated — an import placed earlier in a suite
 * that transitively pulls `~/utils/api` would bind the real client, and the
 * failure would look like a missing tRPC provider rather than an import order.
 * Today no suite does (`~/components/governance/sample`, the only non-harness
 * import above it, reaches none of them). Keep it that way, or move the import
 * below this one.
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
  /** What `activityMonitor.ingestionSourcesHealth` answers. */
  health: { data: undefined as unknown },
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
      activityMonitor: {
        ingestionSourcesHealth: { useQuery: () => hoistedHarness.health },
      },
    },
  };
});

import { AddIngestionSourceMenu } from "../../components/AddIngestionSourceMenu";
import InventoryPage from "../inventory";

/** The real org-admin bag, not a hand-written list that could drift from it. */
export const ORG_ADMIN_PERMISSIONS =
  getOrganizationRolePermissions("ADMIN").slice();

/**
 * A Genie source and a Copilot Studio one: between them they cover a card with
 * a licence read, a card without, and two different environment addresses.
 */
export const CONNECTED_SOURCES = [
  {
    id: "src-genie",
    organizationId: "org-1",
    teamId: null,
    name: "Warehouse questions",
    description: null,
    sourceType: "databricks_genie",
    parserConfig: { workspaceUrl: "https://example-workspace.cloud.test/" },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
  {
    id: "src-copilot",
    organizationId: "org-1",
    teamId: null,
    name: "Assistant transcripts",
    description: null,
    sourceType: "copilot_studio_dataverse",
    parserConfig: {
      environmentUrl: "https://example-env.crm.test",
      readSeats: true,
    },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-05-11T08:30:00.000Z"),
    updatedAt: new Date("2026-05-11T08:30:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
];

export function renderScreen() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance/inventory"]}>
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
  hoistedHarness.health = { data: undefined };
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * An organization with no tools AND the samples turned off.
 *
 * Both halves are needed to see a real empty pane: with nothing connected the
 * page offers sample data by itself, so an empty source list alone renders
 * eight invented cards rather than the empty state. This is the reader who
 * pressed "Hide sample data" and is looking at their actual, empty catalog.
 */
export function emptyWithSamplesOff() {
  hoistedHarness.sources = { data: [], isLoading: false, error: null };
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
}

/** The screen with two tools connected, so sample mode stays off by itself. */
export function connectTools() {
  hoistedHarness.sources = {
    data: CONNECTED_SOURCES,
    isLoading: false,
    error: null,
  };
  hoistedHarness.health = { data: [{ id: "src-genie", eventsLast24h: 1234 }] };
}
