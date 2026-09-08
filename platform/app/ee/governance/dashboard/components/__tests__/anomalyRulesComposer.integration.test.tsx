// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The anomaly-rule composer's choice controls.
 *
 * WHY THIS FILE EXISTS. The composer's four selects used to be swept by the
 * Inventory page test, because the rules were a fourth tab there. They are not
 * any more: a rule is a standing instruction about what to watch for, not a
 * thing the organization runs, so it left the inventory. The assertion did not
 * leave with it. Deleting the tab would otherwise have quietly retired the
 * coverage of four controls that were raw `<select>` elements until recently,
 * and an assertion that disappears with a refactor is indistinguishable from
 * one that never mattered.
 *
 * So this mounts the tab component directly, which is also where it belongs:
 * the claim is about the composer, and it needed a whole page around it only
 * for as long as the composer had no other address.
 *
 * The composer's scope picker is the reason the second half is here. It only
 * renders once the scope stops being the organization, so a test that opens
 * the drawer and stops has not seen it.
 *
 * Specs: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";
import { hasPermissionWithHierarchy } from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(harness.permissions, permission);
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

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: true,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

/**
 * Two ingestion sources, because the composer's source picker is built from
 * the source list and an empty list renders a picker with nothing to choose.
 */
const SOURCES = [
  {
    id: "src-genie",
    name: "Genie warehouse",
    sourceType: "databricks_genie",
    parserConfig: {},
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-01-01").toISOString(),
  },
  {
    id: "src-admin",
    name: "Anthropic admin",
    sourceType: "anthropic_admin",
    parserConfig: {},
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-01-02").toISOString(),
  },
];

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
        anomalyRules: { list: { invalidate: vi.fn() } },
      }),
      anomalyRules: {
        // An empty rule list is enough: the composer's pickers do not depend
        // on there being any rules to compose against.
        list: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        create: mutation(),
        update: mutation(),
        archive: mutation(),
      },
      ingestionSources: {
        list: {
          useQuery: () => ({ data: SOURCES, isLoading: false, error: null }),
        },
      },
    },
  };
});

import { AnomalyRulesTab } from "../AnomalyRulesTab";

function mount() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnomalyRulesTab />
    </ChakraProvider>,
  );
}

/** Opens the composer, failing loudly rather than silently doing nothing. */
async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  const newRule = (
    await screen.findAllByRole("button", { name: /New rule/ })
  )[0];
  if (!newRule) throw new Error("the rules pane has no New rule control");
  await user.click(newRule);
  await screen.findByRole("dialog");
}

beforeEach(() => {
  harness.permissions = ["anomalyRules:view", "anomalyRules:manage"];
});

afterEach(() => {
  cleanup();
});

describe("given a manager composing an anomaly rule", () => {
  describe("when the composer is open", () => {
    /*
     * The positive assertion first. Without it this passes just as loudly on
     * a composer that rendered no controls at all, which is how the earlier
     * version of this sweep went green over five native selects.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select, and its pickers are really on screen", async () => {
      const user = userEvent.setup();
      mount();
      await openComposer(user);

      expect(
        screen.getByRole("combobox", { name: "Severity" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "Scope" }),
      ).toBeInTheDocument();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });

    /*
     * Scope drives a second picker into view. A composer left on the default
     * organization scope never renders it, so the control that was the last
     * raw `<select>` to go would be swept by nothing.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select once the scope narrows to a source type", async () => {
      const user = userEvent.setup();
      mount();
      await openComposer(user);

      await user.click(screen.getByRole("combobox", { name: "Scope" }));
      await user.click(
        await screen.findByRole("option", { name: /source type/i }),
      );

      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
