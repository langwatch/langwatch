// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The edit form's remaining surfaces: why a locked start says it is locked,
 * which immutability copy a pull or a push source is shown, and who is offered
 * the edit control on the source detail page.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 *
 * Drives the real `SourceEditDrawer` and the real detail page. Only the tRPC
 * client is replaced, by a double that answers the one read the page makes.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import IngestionSourceDetailPage from "../governance-ingestion-source.screen.tsx";
import { SourceEditDrawer } from "../governance-inventory.screen.tsx";
import type { Source } from "../ingestion-source-forms.ts";

const harness = vi.hoisted(() => ({ row: undefined as unknown }));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const refetch = vi.fn();
  const queryResult = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch,
  });
  const settledMutation = {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
    data: undefined,
    error: null,
    reset: vi.fn(),
  };
  const mutationResult = () => settledMutation;
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () =>
              queryResult(path.join(".") === "ingestionSources.get" ? harness.row : undefined);
          }
          if (property === "useMutation") return mutationResult;
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property))
            return vi.fn();
          if (property === "useUtils") return () => utils;
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  const utils = node([]);
  return { api, governanceApi: api };
});

afterEach(cleanup);

const ORG_ID = "org_acme";

function sourceRow(overrides: Partial<Source>): Source {
  return {
    id: "src_test",
    organizationId: ORG_ID,
    teamId: null,
    sourceType: "otel_generic",
    name: "Test source",
    description: "",
    parserConfig: {},
    hasPollerCursor: false,
    pullSchedule: null,
    status: "active",
    traceProjectId: null,
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
    ...overrides,
  };
}

const usageSourceThatHasPulled = sourceRow({
  id: "src_anthropic",
  name: "Anthropic org",
  sourceType: "anthropic_admin",
  parserConfig: { report: "usage", startingAt: "2026-03-15T00:00:00.000Z" },
  pullSchedule: "0 * * * *",
  hasPollerCursor: true,
});

const pullSource = sourceRow({
  id: "src_anthropic_pull",
  name: "Anthropic pull",
  sourceType: "anthropic_admin",
  parserConfig: { report: "cost", startingAt: "2026-03-15T00:00:00.000Z" },
  pullSchedule: "0 * * * *",
});

const pushSource = sourceRow({ id: "src_push", name: "Push source", sourceType: "otel_generic" });

const renderDrawer = (source: Source) =>
  renderWithGovernanceHost(
    <SourceEditDrawer
      organizationId={ORG_ID}
      destinationCtx={{
        organizationId: ORG_ID,
        organizationName: "Acme",
        availableTeams: [],
        availableProjects: [],
      }}
      source={source}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      isPending={false}
    />,
    { host: fakeGovernanceHost() },
  );

const renderDetailPage = ({ permissions }: { permissions: readonly string[] }) => {
  harness.row = pushSource;
  return renderWithGovernanceHost(<IngestionSourceDetailPage />, {
    host: fakeGovernanceHost({
      permissions,
      params: { id: pushSource.id },
      organization: { id: ORG_ID, name: "Acme", slug: "acme", teams: [] },
    }),
  });
};

describe("given a source whose backfill start is locked", () => {
  describe("when the admin opens the edit form", () => {
    /** @scenario "A locked backfill start says why it is locked" */
    it("explains behind the title marker that the cursor has moved past the start", async () => {
      renderDrawer(usageSourceThatHasPulled);

      const trigger = screen.getByTestId("edit-source-notes");
      expect(trigger).toBeVisible();
      await userEvent.setup().click(trigger);

      const contentId = trigger.getAttribute("aria-controls");
      if (!contentId) throw new Error("the marker controls no popover");
      const note = await waitFor(() => {
        const content = document.getElementById(contentId);
        if (content?.getAttribute("data-state") !== "open") throw new Error("not open");
        return content.textContent ?? "";
      });
      expect(note).toMatch(/start date is fixed/i);
      expect(note).toMatch(/cursor has already moved past it/i);
    });
  });
});

describe("given the edit form's closing note about what cannot change", () => {
  describe("when the admin opens a pull-mode source", () => {
    /** @scenario "A pull-mode source is not told its ingest secret is immutable" */
    it("says only that the source type is immutable", () => {
      renderDrawer(pullSource);

      expect(screen.queryByText(/ingest secret are immutable/i)).toBeNull();
      expect(screen.getByText(/Source type is immutable after create/i)).toBeInTheDocument();
    });
  });

  describe("when the admin opens a push-mode source", () => {
    /** @scenario "A push-mode source is told both are immutable" */
    it("says both are immutable and points at Rotate secret", () => {
      renderDrawer(pushSource);

      const note = screen.getByText(/Source type and ingest secret are immutable after create/i);
      expect(note).toBeInTheDocument();
      expect(note.textContent).toMatch(/Rotate secret/);
    });
  });
});

describe("given the source detail page", () => {
  describe("when the admin holds ingestionSources:manage", () => {
    /** @scenario "Editing is reachable from the detail page" */
    it("offers an edit control that opens the same configuration form", async () => {
      renderDetailPage({
        permissions: ["governance:view", "ingestionSources:view", "ingestionSources:manage"],
      });

      await userEvent.setup().click(screen.getByRole("button", { name: /Edit/ }));

      expect(
        await screen.findByText(/Source type and ingest secret are immutable/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the admin holds only ingestionSources:view", () => {
    /** @scenario "A viewer without manage permission cannot edit" */
    it("offers no edit control", () => {
      renderDetailPage({ permissions: ["governance:view", "ingestionSources:view"] });

      expect(screen.getByRole("heading", { name: "Push source" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    });
  });
});
