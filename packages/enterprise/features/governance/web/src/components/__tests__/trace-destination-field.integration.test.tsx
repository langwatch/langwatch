// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The trace-destination section of the ingestion-source drawers: which
 * project a conversation-bearing source's conversations land in, plus the
 * three consequences of that choice an admin cannot discover anywhere else.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The picker itself is `ScopeChipPicker` in single-select PROJECT mode —
 * the same control the virtual-key ownership section uses for the same
 * column (`VirtualKeyOwnershipSection.tsx`), so a destination reads the
 * same way wherever it is set.
 *
 * ADR-088 v7: Decision 9 (the column, the cross-org guard, archived
 * handling), Decision 11 (the 31-day horizon), Decision 13 (the
 * destination project's redaction policy governs).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceType } from "../../ingestion-source-catalog";
import { TraceDestinationField } from "../trace-destination-field";

const ORG_ID = "org_acme";
const PROJECTS = [
  { id: "proj_analytics", name: "Analytics · Data", teamId: "team_data" },
  { id: "proj_support", name: "Support · CX", teamId: "team_cx" },
];
const TEAMS = [
  { id: "team_data", name: "Data" },
  { id: "team_cx", name: "CX" },
];

function Harness({
  sourceType,
  initialValue = null,
  mode = "create",
  destinationArchived = false,
  onChangeSpy,
}: {
  sourceType: SourceType;
  initialValue?: string | null;
  mode?: "create" | "edit";
  destinationArchived?: boolean;
  onChangeSpy?: (next: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initialValue);
  return (
    <TraceDestinationField
      sourceType={sourceType}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
      mode={mode}
      destinationArchived={destinationArchived}
      organizationId={ORG_ID}
      organizationName="Acme"
      availableTeams={TEAMS}
      availableProjects={PROJECTS}
    />
  );
}

const renderField = (props: Parameters<typeof Harness>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness {...props} />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("given a source that pulls conversations", () => {
  describe("when the admin composes it", () => {
    /** @scenario "The composer of a conversation source offers a destination" */
    it("offers a destination picker listing only this organization's projects", async () => {
      renderField({ sourceType: "databricks_genie" });
      expect(screen.getByTestId("ingestion-trace-destination")).toBeTruthy();
      expect(screen.getByRole("option", { name: "Analytics · Data" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Support · CX" })).toBeTruthy();
    });

    /** @scenario "The composer of a conversation source offers a destination" */
    it("starts with nothing picked", () => {
      renderField({ sourceType: "databricks_genie" });
      expect(screen.getByTestId("ingestion-trace-destination-empty").textContent).toContain(
        "not be readable in the trace explorer",
      );
    });

    /** @scenario "A source created without a destination routes nothing" */
    it("says, before saving, that conversations are unreadable without one", () => {
      renderField({ sourceType: "databricks_genie" });
      expect(screen.getByTestId("ingestion-trace-destination-empty").textContent).toContain(
        "until you pick one",
      );
    });
  });

  describe("when a destination has been picked", () => {
    /** @scenario "The destination states its three consequences where it is picked" */
    it("says the destination project's data-privacy policy governs storage", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
      });
      expect(screen.getByTestId("ingestion-trace-destination-redaction").textContent).toContain(
        "data-privacy policy",
      );
    });

    /** @scenario "The destination states its three consequences where it is picked" */
    it("states the 31-day horizon and the partial-thread consequence", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
      });
      const horizon = screen.getByTestId("ingestion-trace-destination-horizon").textContent;
      expect(horizon).toContain("last 31 days");
      expect(horizon).toContain("only its more recent turns");
    });

    /** @scenario "The destination states its three consequences where it is picked" */
    it("says an archived or deleted destination stops receiving conversations", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
      });
      expect(screen.getByTestId("ingestion-trace-destination-archival").textContent).toContain(
        "stops receiving",
      );
    });
  });

  /**
   * These cover what the field *says* in edit mode. The other half of the
   * scenario — changing the destination and the update carrying the new one —
   * is bound in `pages/__tests__/sourceEditDestination.integration.test.tsx`,
   * which drives the real drawer's Save button. Nothing here selects or
   * submits anything, so nothing here may claim to.
   */
  describe("when the admin edits it", () => {
    /** @scenario "The edit drawer changes a destination and says history stays" */
    it("shows the destination already stored", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
        mode: "edit",
      });
      expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("proj_analytics");
    });

    /** @scenario "The edit drawer changes a destination and says history stays" */
    it("says conversations already routed stay where they are", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
        mode: "edit",
      });
      expect(screen.getByTestId("ingestion-trace-destination-history").textContent).toContain(
        "stay where they are",
      );
    });

    /** @scenario "The edit drawer changes a destination and says history stays" */
    it("does not promise history stays while composing, where there is none", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_analytics",
        mode: "create",
      });
      expect(screen.queryByTestId("ingestion-trace-destination-history")).toBeNull();
    });
  });

  describe("when the stored destination has since been archived", () => {
    /** @scenario "An archived destination is named as archived, not as absent" */
    it("names it as archived and says routing has stopped", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_gone",
        mode: "edit",
        destinationArchived: true,
      });
      const warning = screen.getByTestId("ingestion-trace-destination-archived").textContent;
      expect(warning).toContain("archived");
      expect(warning).toContain("no longer being routed");
    });

    /** @scenario "An archived destination is named as archived, not as absent" */
    it("does not fall back to the never-configured copy", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_gone",
        mode: "edit",
        destinationArchived: true,
      });
      expect(screen.queryByTestId("ingestion-trace-destination-empty")).toBeNull();
    });

    /**
     * @scenario "An archived destination is named as archived, not as absent"
     *
     * Telling an admin routing has stopped and giving them no control to
     * restart it strands them: the drawer would refuse every save, because
     * the archived id fails the write-time guard on the way back out.
     */
    it("still offers the picker, so there is a way to repoint it", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_gone",
        mode: "edit",
        destinationArchived: true,
      });
      expect(screen.getByRole("combobox")).toBeTruthy();
    });
  });

  describe("when the stored destination is one this admin cannot see", () => {
    /**
     * `proj_hidden` is absent from `availableProjects` exactly as an archived
     * one would be, but the server has not called it archived — so neither
     * does the drawer. The two are distinguishable server-side because
     * `liveTraceProjectIds` scopes liveness to the organization
     * (`ingestionSource.service.ts:296-304`), not to the reader's teams, so a
     * project this admin cannot see is still live. Calling it archived would
     * send them to restore a project that is fine.
     */
    /** @scenario "A destination the admin cannot see is not called archived" */
    it("does not call it archived, because unresolvable is not the same as gone", () => {
      renderField({
        sourceType: "databricks_genie",
        initialValue: "proj_hidden",
        mode: "edit",
        destinationArchived: false,
      });
      expect(screen.queryByTestId("ingestion-trace-destination-archived")).toBeNull();
    });
  });
});

describe("given a source that pulls counts rather than conversations", () => {
  describe("when the admin composes or edits it", () => {
    /** @scenario "A source that pulls counts is offered no destination" */
    it("offers no destination at all while composing", () => {
      renderField({ sourceType: "anthropic_admin" });
      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
    });

    /** @scenario "A source that pulls counts is offered no destination" */
    it("offers no destination while editing either", () => {
      renderField({ sourceType: "anthropic_admin", mode: "edit" });
      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
    });

    /** @scenario "A source that pulls counts is offered no destination" */
    it("offers none for a push-mode source, which never routes conversations", () => {
      renderField({ sourceType: "otel_generic" });
      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
    });
  });
});
