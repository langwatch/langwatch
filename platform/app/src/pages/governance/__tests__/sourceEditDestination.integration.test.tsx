// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Changing a source's destination in the edit drawer, all the way to the
 * payload the update mutation receives.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * `TraceDestinationField.integration.test.tsx` covers what the field says.
 * This covers what happens when the admin acts on it — the half of the
 * scenario ("they change it to Support and save", "the update carries
 * Support") that reading copy cannot prove.
 *
 * It drives the real `SourceEditDrawer`: the real picker, the real
 * `useSourceEditForm` state, the real Save button, and the real
 * `buildUpdateInput` call behind it. A harness that re-implemented
 * `handleSubmit` would only prove the copy agrees with itself, and would keep
 * passing after the drawer stopped passing `destination` through.
 *
 * ADR-088 v7, Decision 9.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { SourceEditDrawer } from "../inventory.enterprise";

/**
 * `OttlEditor` sits inside the drawer's body and calls tRPC on render. It is
 * not what this file is about, so it gets the smallest stub that lets the
 * drawer mount: a starter query with no data and a validate mutation nobody
 * invokes.
 */
vi.mock("~/utils/api", () => ({
  api: {
    ingestionSources: {
      ottlStarter: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      validateOttl: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          data: undefined,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const ORG_ID = "org_acme";

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

/**
 * A Genie source that already lands in Analytics. Only the fields the drawer
 * reads are set; the row carries many more, and typing them here would tie
 * this test to columns it never looks at.
 */
const sourceLandingInAnalytics = {
  id: "src_genie",
  name: "Genie fleet",
  description: "Conversations from the Genie workspace",
  sourceType: "databricks_genie",
  parserConfig: { workspaceId: "ws_acme" },
  traceProjectId: "proj_analytics",
  traceProjectArchived: false,
} as unknown as Parameters<typeof SourceEditDrawer>[0]["source"];

/**
 * The same source after its destination project was archived. The server
 * reports the archival on the row (`ingestionSources.ts:101`); the id stays,
 * because forgetting it would lose the only record of where the source used
 * to land.
 */
const sourceLandingInAnArchivedProject = {
  ...sourceLandingInAnalytics,
  traceProjectId: "proj_gone",
  traceProjectArchived: true,
} as unknown as Parameters<typeof SourceEditDrawer>[0]["source"];

/** Exactly what `buildUpdateInput` produces, read off the drawer's own prop. */
type UpdateInput = Parameters<
  Parameters<typeof SourceEditDrawer>[0]["onSubmit"]
>[0];

let onSubmit: Mock<(input: UpdateInput) => void>;

const renderDrawer = (source = sourceLandingInAnalytics) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SourceEditDrawer
        organizationId={ORG_ID}
        destinationCtx={DESTINATION_CTX}
        source={source}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />
    </ChakraProvider>,
  );

const pickDestination = async ({
  user,
  projectName,
}: {
  user: ReturnType<typeof userEvent.setup>;
  projectName: string;
}) => {
  await user.click(screen.getByRole("combobox"));
  await user.click(within(screen.getByRole("listbox")).getByText(projectName));
};

const submittedInput = () => onSubmit.mock.calls[0]?.[0];

beforeEach(() => {
  onSubmit = vi.fn<(input: UpdateInput) => void>();
});

describe("given a Genie source that already lands in Analytics", () => {
  describe("when the admin opens it for editing", () => {
    /**
     * Covers the scenario's first half: the picker shows the stored project,
     * and the drawer states that already-routed conversations stay put. The
     * second half — changing it and saving — is the test below.
     */
    /** @scenario "The edit drawer changes a destination and says history stays" */
    it("shows Analytics as the destination it is stored with, and says routed history stays", () => {
      renderDrawer();
      expect(
        within(screen.getByRole("combobox")).getByText("Analytics · Data"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("ingestion-trace-destination-history"),
      ).toBeTruthy();
    });
  });

  describe("when they change it to Support and save", () => {
    /** @scenario "The edit drawer changes a destination and says history stays" */
    it("carries Support as the destination in the update", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await pickDestination({ user, projectName: "Support · CX" });
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(submittedInput()).toMatchObject({
        organizationId: ORG_ID,
        id: "src_genie",
        traceProjectId: "proj_support",
      });
    });

    /**
     * Deliberately carries no `@scenario` annotation: it runs the scenario's
     * interaction but asserts something the scenario never claims. It is a
     * regression guard on the save above — the picker is the only thing that
     * moved, so nothing else may move with it. A save that quietly renamed
     * the source or dropped its parserConfig would still satisfy the
     * destination assertion.
     */
    it("leaves the fields the admin did not touch as they were", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await pickDestination({ user, projectName: "Support · CX" });
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(submittedInput()).toMatchObject({
        name: "Genie fleet",
        description: "Conversations from the Genie workspace",
        parserConfig: { workspaceId: "ws_acme" },
      });
    });
  });

  describe("when they save without touching the destination", () => {
    /**
     * Deliberately carries no `@scenario` annotation: the scenario is about
     * changing a destination, and this test is the opposite interaction.
     *
     * An untouched picker must send no destination at all, because
     * `updateSource` re-validates whatever it is handed
     * (`ingestionSource.service.ts:529-539`) and would reject a stored id
     * whose project has since been archived — locking the admin out of
     * renaming the source, let alone repointing it.
     */
    it("sends no destination key, rather than echoing the stored one", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(submittedInput()).not.toHaveProperty("traceProjectId");
    });
  });
});

describe("given a Genie source whose destination project has been archived", () => {
  describe("when the admin picks a replacement to repoint it", () => {
    /**
     * The scenario offers the picker in the archived state "so the admin can
     * repoint the source rather than being told routing stopped and given no
     * way to restart it". That promise is only kept if picking actually shows
     * the pick: the archived flag describes the *stored* destination, so once
     * a replacement is chosen it no longer describes what is on screen. Left
     * uncleared, the admin selects a project, sees the picker stay empty
     * under an unchanged archived warning, and reasonably concludes the
     * control is dead.
     */
    /** @scenario "An archived destination is named as archived, not as absent" */
    it("shows the replacement in the picker and drops the archived warning", async () => {
      const user = userEvent.setup();
      renderDrawer(sourceLandingInAnArchivedProject);

      expect(
        screen.getByTestId("ingestion-trace-destination-archived"),
      ).toBeTruthy();

      await pickDestination({ user, projectName: "Support · CX" });

      expect(
        within(screen.getByRole("combobox")).getByText("Support · CX"),
      ).toBeTruthy();
      expect(
        screen.queryByTestId("ingestion-trace-destination-archived"),
      ).toBeNull();
    });

    /**
     * Deliberately carries no `@scenario` annotation: a regression guard on
     * the repoint completing, not on how the archived state is named.
     */
    it("carries the replacement as the destination in the update", async () => {
      const user = userEvent.setup();
      renderDrawer(sourceLandingInAnArchivedProject);

      await pickDestination({ user, projectName: "Support · CX" });
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(submittedInput()).toMatchObject({
        traceProjectId: "proj_support",
      });
    });
  });
});
