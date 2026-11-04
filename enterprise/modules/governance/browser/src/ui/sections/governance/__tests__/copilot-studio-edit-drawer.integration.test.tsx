// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Copilot Studio connection as the edit drawer renders it (#9275): the stored address, the
 * app registration fields opening blank, and the environment read-only once the source has
 * pulled. `copilot-studio-edit-connection.unit.test.ts` covers what the form submits.
 * Spec: specs/governance/edit-pull-source-config.feature
 *
 * Drives the real `SourceEditDrawer`; only the tRPC client is replaced, by a double that answers
 * no reads, because the drawer's connection fields make none.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SourceEditDrawer } from "../governance-inventory.screen.tsx";
import type { Source } from "../ingestion-source-forms.ts";

vi.mock("../../../../behavior/governance-api.ts", () => {
  const settledMutation = {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
    data: undefined,
    error: null,
    reset: vi.fn(),
  };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
          }
          if (property === "useMutation") return () => settledMutation;
          if (property === "useUtils") return () => node();
          return node();
        },
      },
    );
  const api = node();
  return { api, governanceApi: api };
});

afterEach(cleanup);

const ORG_ID = "org_acme";
const ENVIRONMENT = "https://org12345.crm.dynamics.com";

const copilotSourceThatHasPulled: Source = {
  id: "src_copilot",
  organizationId: ORG_ID,
  teamId: null,
  sourceType: "copilot_studio_dataverse",
  name: "Copilot Studio",
  description: null,
  parserConfig: {
    adapter: "copilot_studio_dataverse",
    environmentUrl: ENVIRONMENT,
    botIds: [],
    readSeats: true,
    readDirectory: true,
    schedule: "*/15 * * * *",
  },
  hasPollerCursor: true,
  pullSchedule: "*/15 * * * *",
  status: "active",
  traceProjectId: "proj_analytics",
  traceProjectArchived: false,
  lastEventAt: null,
  archivedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  createdById: null,
  errorCount: 0,
  lastRunCompleteness: null,
  pullStatus: null,
  lastSuccessAt: null,
};

const DESTINATION_CTX = {
  organizationId: ORG_ID,
  organizationName: "Acme",
  availableTeams: [
    { id: "team_data", name: "Data" },
    { id: "team_cx", name: "CX" },
  ],
  availableProjects: [
    { id: "proj_analytics", name: "Analytics · Data", teamId: "team_data" },
    { id: "proj_support", name: "Support · CX", teamId: "team_cx" },
  ],
};

/** Exactly what the drawer submits, read off its own prop. */
type UpdateInput = Parameters<Parameters<typeof SourceEditDrawer>[0]["onSubmit"]>[0];

const renderDrawer = (onSubmit: (input: UpdateInput) => void = vi.fn()) =>
  renderWithGovernanceHost(
    <SourceEditDrawer
      organizationId={ORG_ID}
      destinationCtx={DESTINATION_CTX}
      source={copilotSourceThatHasPulled}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      isPending={false}
    />,
    { host: fakeGovernanceHost() },
  );

/** The text of the popover a field's (i) marker opens. */
async function popoverText(triggerTestId: string): Promise<string> {
  const trigger = screen.getByTestId(triggerTestId);
  await userEvent.setup().click(trigger);
  const contentId = trigger.getAttribute("aria-controls");
  if (!contentId) throw new Error(`${triggerTestId} controls no popover`);
  return waitFor(() => {
    const content = document.getElementById(contentId);
    if (content?.getAttribute("data-state") !== "open") throw new Error("not open");
    return content.textContent ?? "";
  });
}

const APP_REGISTRATION = [
  "Microsoft Entra tenant ID",
  "App registration client ID",
  "App registration client secret",
] as const;

describe("given a Copilot Studio source that has completed a pull", () => {
  describe("when the admin opens the edit drawer", () => {
    /** @scenario "The edit drawer shows the stored connection with its secrets blank" */
    it("shows the environment address and the three app registration fields", () => {
      renderDrawer();

      expect(screen.getByLabelText("Power Platform environment URL")).toHaveValue(ENVIRONMENT);
      for (const label of APP_REGISTRATION) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });

    /** @scenario "The edit drawer shows the stored connection with its secrets blank" */
    it("opens the three secret fields empty, saying they are replaced together", async () => {
      renderDrawer();

      for (const label of APP_REGISTRATION) {
        expect(screen.getByLabelText(label)).toHaveValue("");
      }
      expect(await popoverText("parser-field-info-credentialsTenantId")).toMatch(
        /all blank to keep the current app registration.*enter all three together/,
      );
    });

    /** @scenario "The edit drawer shows the stored connection with its secrets blank" */
    it("shows the environment address read-only, with a note saying why", async () => {
      renderDrawer();

      expect(screen.getByLabelText("Power Platform environment URL")).toHaveAttribute("readonly");
      expect(await popoverText("edit-source-notes")).toMatch(/environment is fixed/);
    });
  });
});

describe("given a Copilot Studio source that lands its conversations in Analytics", () => {
  describe("when the admin opens the edit drawer's Advanced group", () => {
    /** @scenario "The Copilot Studio edit drawer moves the destination alongside the cadence" */
    it("shows the pull cadence and the destination picker in that one group", async () => {
      const user = userEvent.setup();
      renderDrawer();

      expect(screen.getAllByText("Advanced")).toHaveLength(1);
      await user.click(screen.getByText("Advanced"));
      const destination = await screen.findByTestId("ingestion-trace-destination");
      const cadence = screen.getByTestId("cadence-field-info");

      const group = destination.closest('[data-scope="collapsible"][data-part="content"]');
      expect(group).not.toBeNull();
      expect(group?.contains(cadence)).toBe(true);
      expect(
        within(within(destination).getByRole("combobox")).getByText("Analytics · Data"),
      ).toBeInTheDocument();
    });

    /** @scenario "The Copilot Studio edit drawer moves the destination alongside the cadence" */
    it("carries a newly picked project in the update", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn<(input: UpdateInput) => void>();
      renderDrawer(onSubmit);

      await user.click(screen.getByText("Advanced"));
      const destination = await screen.findByTestId("ingestion-trace-destination");
      await user.click(within(destination).getByRole("combobox"));
      await user.click(within(screen.getByRole("listbox")).getByText("Support · CX"));
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        organizationId: ORG_ID,
        id: "src_copilot",
        traceProjectId: "proj_support",
      });
    });
  });
});
