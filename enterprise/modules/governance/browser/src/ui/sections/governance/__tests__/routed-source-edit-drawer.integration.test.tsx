// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The source edit drawer opened by address
 * (`?drawer.open=editIngestionSource&drawer.sourceId=<id>`): what it shows
 * before it has a source to edit, for a reader who may not edit, and for an
 * address naming a source the organization does not hold.
 *
 * Only the tRPC client and the drawer service are doubled.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import type { Source } from "../ingestion-source-forms.ts";

const harness = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, error: null as unknown },
  listEnabled: [] as boolean[],
  refetch: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: harness.closeDrawer, goBack: vi.fn() }),
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    data: undefined,
    error: null,
  });
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "useQuery") {
          if (path.join(".") === "ingestionSources.list") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              harness.listEnabled.push(options?.enabled ?? true);
              return { ...harness.list, refetch: harness.refetch };
            };
          }
          return () => ({ data: undefined, isLoading: false, error: null });
        }
        if (property === "useMutation") return mutation;
        if (property === "useUtils") return () => node([]);
        return node([...path, property]);
      },
    });
  const api = node([]);
  return { api, governanceApi: api };
});

import { RoutedSourceEditDrawer } from "../routed-source-edit-drawer.tsx";

const MANAGER = [...builtinRolePermissions("org-admin")];
const READER = ["governance:view", "ingestionSources:view"];

function sourceRow(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_known",
    organizationId: "org_acme",
    teamId: null,
    sourceType: "otel_generic",
    name: "Known source",
    description: null,
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

function renderDrawer({
  permissions = MANAGER,
  sourceId = "src_known",
}: { permissions?: readonly string[]; sourceId?: string } = {}) {
  return renderWithGovernanceHost(<RoutedSourceEditDrawer sourceId={sourceId} />, {
    host: fakeGovernanceHost({ permissions }),
  });
}

beforeEach(() => {
  harness.list = { data: [sourceRow()], isLoading: false, error: null };
  harness.listEnabled = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the source edit drawer opened by address", () => {
  describe("given a reader who may read sources but not manage them", () => {
    /** @scenario "A reader without the manage grant is told why instead of shown the edit form" */
    it("names the missing grant in an open drawer and offers no save", () => {
      harness.list = { data: [sourceRow()], isLoading: false, error: null };
      renderDrawer({ permissions: READER });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/ingestionSources:manage/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(screen.queryByDisplayValue("Known source")).toBeNull();
    });
  });

  describe("given the source list has not answered yet", () => {
    /** @scenario "The edit drawer says it is loading while the source is read" */
    it("opens the drawer in its loading state rather than rendering nothing", () => {
      harness.list = { data: undefined, isLoading: true, error: null };
      renderDrawer();

      const drawer = screen.getByRole("dialog");
      expect(within(drawer).getByTestId("skeleton-rows")).toHaveAttribute("aria-busy", "true");
      expect(within(drawer).getByText("Loading the source")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    });
  });

  describe("given an address naming a source the organization does not hold", () => {
    /** @scenario "An edit address naming an unknown source says so and can be closed" */
    it("says the source is not there and closes the drawer when asked", async () => {
      renderDrawer({ sourceId: "src_gone" });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("edit-source-not-found")).toHaveTextContent(
        "This source isn't in the organization's list",
      );
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(harness.closeDrawer).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the source list read fails", () => {
    /** @scenario "A failed source read in the edit drawer shows the failure and a retry" */
    it("shows the failure with a way to try again, and no form", async () => {
      harness.list = { data: undefined, isLoading: false, error: new Error("read failed") };
      renderDrawer();

      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this source");
      expect(screen.queryByTestId("edit-source-not-found")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(harness.refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a manager and an address naming a source the organization holds", () => {
    /** @scenario "A manager opening the edit address gets the source's edit form" */
    it("opens the edit form for that source", () => {
      renderDrawer();

      expect(screen.getByDisplayValue("Known source")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    });
  });
});
