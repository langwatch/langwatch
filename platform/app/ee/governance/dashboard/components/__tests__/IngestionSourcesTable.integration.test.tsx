// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The configured-sources table on the inventory's Sources tab: one table
 * with delivery as a column (real-time first, then scheduled, by name),
 * the cadence in a few words under the protocol chip, the real counts in
 * the header, and every row action behind the overflow menu.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       ("The sources table shows delivery as a column",
 *        "Row actions live in the overflow menu")
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../../pages/ingestionSourceForms";
import {
  IngestionSourcesTable,
  sortSourcesForTable,
} from "../IngestionSourcesTable";

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    organizationId: "org-1",
    name: overrides.id,
    description: null,
    sourceType: "otel_generic",
    status: "awaiting_first_event",
    lastEventAt: null,
    pullSchedule: null,
    ...overrides,
  } as Source;
}

const WORKATO = makeSource({
  id: "src-workato",
  name: "Workato prod",
  sourceType: "workato",
  status: "active",
  lastEventAt: new Date(Date.now() - 2 * 60 * 1000),
});
const OTEL = makeSource({
  id: "src-otel",
  name: "Agents OpenTelemetry",
  sourceType: "otel_generic",
});
const ANTHROPIC = makeSource({
  id: "src-anthropic",
  name: "Anthropic spend",
  sourceType: "anthropic_admin",
  pullSchedule: "0 * * * *",
});

const FLEET = [ANTHROPIC, WORKATO, OTEL];

function Providers({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter>{children}</MemoryRouter>
    </ChakraProvider>
  );
}

function renderTable({
  sources = FLEET,
  canManage = true,
}: {
  sources?: Source[];
  canManage?: boolean;
} = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onRotate: vi.fn(),
    onArchive: vi.fn(),
  };
  render(
    <Providers>
      <IngestionSourcesTable
        sources={sources}
        canManage={canManage}
        rotatingId={null}
        archivingId={null}
        {...handlers}
      />
    </Providers>,
  );
  return handlers;
}

afterEach(() => cleanup());

describe("given the ingestion sources table", () => {
  describe("when the fleet mixes real-time and scheduled sources", () => {
    /** @scenario "The sources table shows delivery as a column" */
    it("lists them in one table, real-time first and by name within each", () => {
      expect(sortSourcesForTable(FLEET).map((s) => s.name)).toEqual([
        "Agents OpenTelemetry",
        "Workato prod",
        "Anthropic spend",
      ]);

      renderTable();

      const rows = screen.getAllByRole("row").slice(1); // header row first
      expect(
        rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent),
      ).toEqual([
        expect.stringContaining("Agents OpenTelemetry"),
        expect.stringContaining("Workato prod"),
        expect.stringContaining("Anthropic spend"),
      ]);
      expect(
        screen.getByRole("columnheader", { name: "Delivery" }),
      ).toBeVisible();
      expect(screen.getAllByText("Real-time")).toHaveLength(2);
      expect(screen.getAllByText("Scheduled")).toHaveLength(1);
      // The two group headings the page used to draw are gone.
      expect(screen.queryByText("Real-time streams")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Synced on a schedule"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The sources table shows delivery as a column" */
    it("reads a scheduled source's cadence in a few words under its protocol chip", () => {
      renderTable();

      const row = screen.getByTestId("source-row-src-anthropic");
      expect(within(row).getByText("API pull")).toBeVisible();
      expect(within(row).getByText("Hourly")).toBeVisible();
      // Push sources carry no cadence.
      const pushRow = screen.getByTestId("source-row-src-workato");
      expect(
        within(pushRow).queryByText(/Hourly|Every/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when an admin opens a row's actions", () => {
    /** @scenario "Row actions live in the overflow menu" */
    it("offers Edit, Rotate secret and Archive on a real-time source", async () => {
      const user = userEvent.setup();
      const handlers = renderTable();

      await user.click(
        screen.getByRole("button", { name: "Actions for Workato prod" }),
      );
      expect(
        await screen.findByRole("menuitem", { name: /Rotate secret/ }),
      ).toBeVisible();
      expect(screen.getByRole("menuitem", { name: /Edit/ })).toBeVisible();
      await user.click(screen.getByRole("menuitem", { name: /Archive/ }));
      expect(handlers.onArchive).toHaveBeenCalledWith("src-workato");
      // No inline buttons anywhere in the row.
      expect(
        within(screen.getByTestId("source-row-src-workato")).getAllByRole(
          "button",
        ),
      ).toHaveLength(1);
    });

    /** @scenario "Row actions live in the overflow menu" */
    it("offers no secret rotation on a scheduled source", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", { name: "Actions for Anthropic spend" }),
      );
      expect(
        await screen.findByRole("menuitem", { name: /Edit/ }),
      ).toBeVisible();
      expect(
        screen.queryByRole("menuitem", { name: /Rotate secret/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a source is named after its own type", () => {
    /**
     * The sample rows are exactly this shape — they carry the catalog's label
     * as the name — so without the guard the Sources tab printed every
     * connector's name twice, one line above the other.
     *
     * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
     */
    /** @scenario "A source named after its own type does not say so twice" */
    it("writes the type once", () => {
      renderTable({
        sources: [
          makeSource({
            id: "src-named-after-type",
            name: "Workato",
            sourceType: "workato",
          }),
        ],
      });

      const row = screen.getByTestId("source-row-src-named-after-type");
      expect(within(row).getAllByText("Workato")).toHaveLength(1);
    });

    /** @scenario "A source named after its own type does not say so twice" */
    it("still writes the type under a name of the admin's own", () => {
      renderTable({ sources: [WORKATO] });

      const row = screen.getByTestId("source-row-src-workato");
      expect(within(row).getByText("Workato prod")).toBeVisible();
      expect(within(row).getByText("Workato")).toBeVisible();
    });
  });

  describe("when the viewer cannot manage sources", () => {
    /** @scenario "Row actions live in the overflow menu" */
    it("renders no row actions at all", () => {
      renderTable({ canManage: false });

      expect(
        screen.queryByRole("button", { name: /Actions for/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Workato prod")).toBeVisible();
    });
  });
});
