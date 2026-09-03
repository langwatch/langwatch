/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PersonalRecentTracesTable } from "../ui/sections/personal-recent-traces-table";
import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../testing";

function renderEmpty(slug = "acme-personal") {
  return renderWithPersonalWorkspaceHost(<PersonalRecentTracesTable projectSlug={slug} />, {
    host: fakePersonalWorkspaceHost(),
  });
}

/**
 * The card is a PLACEHOLDER since the move: the trace explorer's table lives
 * under `platform/app`'s `features/traces-v2` and a feature-web package may not
 * reach into it, so the card renders the integrate pitch and never the ten
 * rows. What these cases pin is exactly what still ships — which is why they
 * travelled unchanged: every one of them was already about the empty state.
 */
describe("PersonalRecentTracesTable", () => {
  afterEach(cleanup);

  describe("given the personal project has no traces", () => {
    /** @scenario Recent activity with no traces points to the on-page setup tiles, not SDK integration */
    it("pitches the on-page setup tiles instead of the project SDK/MCP guide", () => {
      renderEmpty();

      expect(screen.getByText("No activity here yet")).toBeTruthy();
      expect(screen.getByText("Set up a coding assistant")).toBeTruthy();
      expect(screen.getByText("Mint an ingestion key")).toBeTruthy();
      expect(screen.getByText("Create an API key")).toBeTruthy();

      // It must NOT reuse the project traces page's agent / MCP / SDK pitch.
      expect(screen.queryByText(/Instrument your agents/i)).toBeNull();
      expect(screen.queryByText(/Skills\s+and\s+MCP/i)).toBeNull();
    });

    it("links the API-key offer to the api-keys settings page", () => {
      renderEmpty("jane-personal");

      const link = screen.getByText("Create an API key").closest("a");
      // Settings is a top-level route. A project-slug prefix has no route
      // behind it and lands the reader on a 404 or, for a member whose
      // ambient team resolves elsewhere, on a refusal.
      expect(link?.getAttribute("href")).toBe("/settings/api-keys");
    });

    it("renders the two in-page offers as buttons (scroll to the matching section)", () => {
      renderEmpty();

      expect(screen.getByText("Set up a coding assistant").closest("button")).toBeTruthy();
      expect(screen.getByText("Mint an ingestion key").closest("button")).toBeTruthy();
    });
  });
});
