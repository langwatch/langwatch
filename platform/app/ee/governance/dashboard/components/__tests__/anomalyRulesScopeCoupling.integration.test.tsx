// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * What the composer submits after the scope changes under it.
 *
 * WHY THIS FILE EXISTS. `scope` and `scopeId` are one fact in two fields, and
 * nothing was holding them together. Picking a specific source wrote a source
 * id; changing the scope afterwards left that id in place. The source-type
 * picker then rendered a value that is not one of its options, so it fell back
 * to the placeholder and read as unset — while the submit button, which only
 * asks whether `scopeId` is non-empty, stayed enabled. The rule saved as
 * `{ scope: "source_type", scopeId: "<a source id>" }` and the subscriber
 * compared a source type against a source id forever after. No error, no
 * empty field, a rule that simply never fires.
 *
 * Asserted twice, at both ends. The submit control is where the two fields
 * first disagree in a way an admin can see, and the mutation payload is what
 * actually reaches the server — `{ scope: "source_type", scopeId: "src-genie" }`
 * before the fix. Each is paired with a positive control, because "the button
 * is disabled" and "nothing was sent" both pass just as loudly on a composer
 * that never opened.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasPermissionWithHierarchy } from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  /** What the create mutation was actually asked to persist. */
  create: vi.fn(),
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

/** One source is enough to put a real id into `scopeId`. */
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
];

vi.mock("~/utils/api", () => {
  const mutation = (mutate = vi.fn()) => ({
    useMutation: () => ({
      mutate,
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
        list: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        create: mutation(harness.create),
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

async function chooseOption({
  user,
  picker,
  option,
}: {
  user: ReturnType<typeof userEvent.setup>;
  picker: string;
  option: RegExp;
}) {
  await user.click(screen.getByRole("combobox", { name: picker }));
  await user.click(await screen.findByRole("option", { name: option }));
}

function submitButton() {
  return screen.getByRole("button", { name: "Create rule" });
}

beforeEach(() => {
  harness.permissions = ["anomalyRules:view", "anomalyRules:manage"];
  harness.create.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("given a manager composing a rule scoped to one ingestion source", () => {
  /**
   * Named, scoped, and pointed at a real source: everything the composer asks
   * for. This is the control. Without it the second test's disabled button
   * proves nothing, because a composer that failed to open has a disabled
   * button too.
   */
  async function composeSourceScopedRule(
    user: ReturnType<typeof userEvent.setup>,
  ) {
    mount();
    await openComposer(user);
    await chooseOption({
      user,
      picker: "Scope",
      option: /specific ingestion source/i,
    });
    await chooseOption({
      user,
      picker: "Ingestion source",
      option: /Genie warehouse/i,
    });
    // The picker's trigger reading back the chosen source is the commit
    // landing. Asserting the submit button straight after the click races it.
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Ingestion source" }),
      ).toHaveTextContent("Genie warehouse (databricks_genie)"),
    );
    // The name goes in last on purpose. Typed as the drawer's first
    // interaction it lands nowhere: the drawer takes focus back after mount
    // and the keystrokes are dropped. Worth a look of its own; not this fix.
    // The field is labelled by a sibling `Text` rather than a bound `<label>`,
    // so a placeholder is the only handle it has.
    const name = screen.getByPlaceholderText("Display name for this rule");
    await user.type(name, "Genie spend spike");
    await waitFor(() => expect(name).toHaveValue("Genie spend spike"));
  }

  describe("when the rule is complete", () => {
    it("can be submitted", async () => {
      const user = userEvent.setup();
      await composeSourceScopedRule(user);

      expect(submitButton()).toBeEnabled();
    });
  });

  describe("when the scope then changes to a source type", () => {
    it("cannot be submitted until a source type is chosen", async () => {
      const user = userEvent.setup();
      await composeSourceScopedRule(user);

      await chooseOption({
        user,
        picker: "Scope",
        option: /ingestion source type/i,
      });

      expect(submitButton()).toBeDisabled();
    });

    it("can be submitted again once a source type is chosen", async () => {
      const user = userEvent.setup();
      await composeSourceScopedRule(user);

      await chooseOption({
        user,
        picker: "Scope",
        option: /ingestion source type/i,
      });
      await chooseOption({
        user,
        picker: "Source type",
        option: /Claude Code/i,
      });

      expect(submitButton()).toBeEnabled();
    });

    /*
     * The one that fails against the unfixed composer. Pressing submit with
     * the scope changed and no new id chosen sent
     * `{ scope: "source_type", scopeId: "src-genie" }` — the pair the
     * subscriber could never match. The control below proves a finished rule
     * does reach the mutation, so this absence is not the absence of a
     * working form.
     */
    it("sends nothing while the scope has no id of its own", async () => {
      const user = userEvent.setup();
      await composeSourceScopedRule(user);

      await chooseOption({
        user,
        picker: "Scope",
        option: /ingestion source type/i,
      });
      await user.click(submitButton());

      expect(harness.create).not.toHaveBeenCalled();
    });

    /*
     * The control, and the guard that outlives the disabled rule: whatever
     * the form does on the way there, the pair that reaches the server has
     * to agree.
     */
    it("persists the chosen source type, never the source id it replaced", async () => {
      const user = userEvent.setup();
      await composeSourceScopedRule(user);

      await chooseOption({
        user,
        picker: "Scope",
        option: /ingestion source type/i,
      });
      await chooseOption({
        user,
        picker: "Source type",
        option: /Claude Code/i,
      });
      await user.click(submitButton());

      await waitFor(() => expect(harness.create).toHaveBeenCalledTimes(1));
      expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
        scope: "source_type",
        scopeId: "claude_code",
      });
    });
  });
});
