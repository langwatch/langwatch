// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * A Security Lake source's own page: it has no ingest secret to rotate, and its settings are
 * edited in the Security Lake section, not in the generic edit drawer.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SourceDetailHeader } from "../governance-ingestion-source.screen.tsx";
import type { Source } from "../ingestion-source-forms.ts";

afterEach(cleanup);

function sourceRow(overrides: Partial<Source>): Source {
  return {
    id: "src_lake",
    organizationId: "org_acme",
    teamId: null,
    sourceType: "security_lake",
    name: "ACME Security Lake",
    description: null,
    parserConfig: {},
    hasPollerCursor: false,
    pullSchedule: "*/5 * * * *",
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

function renderHeader({ source, onEdit = vi.fn() }: { source: Source; onEdit?: () => void }) {
  const host = fakeGovernanceHost();
  renderWithGovernanceHost(
    <SourceDetailHeader
      source={source}
      canManage
      isRotating={false}
      isArchiving={false}
      onRotate={vi.fn()}
      onArchive={vi.fn()}
      onEdit={onEdit}
    />,
    { host },
  );
  return { host, onEdit };
}

describe("given a Security Lake source's own page", () => {
  describe("when an admin reads the header", () => {
    /** @scenario "A Security Lake source's own page offers no secret to rotate" */
    it("offers no Rotate secret", () => {
      renderHeader({ source: sourceRow({}) });

      expect(screen.queryByRole("button", { name: /Rotate secret/ })).not.toBeInTheDocument();
    });

    /** @scenario "A Security Lake source's own page offers no secret to rotate" */
    it("sends Edit to the Security Lake settings rather than the generic drawer", async () => {
      const { host, onEdit } = renderHeader({ source: sourceRow({}) });

      await userEvent.click(screen.getByRole("button", { name: /Edit in Security Lake settings/ }));

      expect(onEdit).not.toHaveBeenCalled();
      expect(host.recording.navigations).toEqual(["/governance/inventory?tab=sources"]);
    });
  });

  describe("when the source is a push source with an ingest secret", () => {
    it("still offers Rotate secret and the generic Edit", async () => {
      const { onEdit } = renderHeader({ source: sourceRow({ sourceType: "otel_generic" }) });

      expect(screen.getByRole("button", { name: /Rotate secret/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });
});
