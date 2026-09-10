// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Events section when it has no rows to show: an empty pane that says what
 * state the source is in, and setup instructions behind an (i) rather than in
 * the page body.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (scenario "An idle source explains itself in a pane, not in a wall of
 *       setup text")
 *
 * WHAT THESE ASSERT AND WHY. The regression they exist to prevent is prose
 * sliding back into the body, so the empty-pane test names the setup sentences
 * and demands their ABSENCE — a test that only checked the headline would pass
 * with the old four paragraphs still sitting underneath it. And an absence
 * assertion proves nothing unless the same query can find the text when it IS
 * present, so the popover test looks up the identical strings after opening
 * the (i).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
// Chakra's Popover keeps its content MOUNTED and hidden while closed, so
// `queryByText` finds it either way. Only a visibility matcher can tell the
// two states apart, which is the whole point of these assertions.
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  EmptyEventsState,
  EventsSetupPopover,
  ingestEndpointFor,
} from "../SourceEventsSetup";

function renderUi(ui: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

const OTEL_SOURCE = { id: "src_1", sourceType: "otel_generic" };

describe("given an ingestion source with no events", () => {
  describe("when the empty pane renders", () => {
    /** @scenario "An idle source explains itself in a pane, not in a wall of setup text" */
    it("draws the section's empty state with a headline and one sentence", () => {
      renderUi(<EmptyEventsState />);

      expect(screen.getByTestId("source-events-empty")).toBeTruthy();
      expect(screen.getByText("No events from this source yet")).toBeTruthy();
      expect(
        screen.getByText(/Nothing has arrived on this source's endpoint/),
      ).toBeTruthy();
    });

    /** @scenario "An idle source explains itself in a pane, not in a wall of setup text" */
    it("keeps the setup instructions out of the page body", () => {
      renderUi(<EmptyEventsState />);

      expect(screen.queryByText(/Push an OTLP body to/)).toBeNull();
      expect(
        screen.queryByText(/Spans land in the LangWatch trace store/),
      ).toBeNull();
      expect(screen.queryByText(/copy-paste curl example/)).toBeNull();
      expect(screen.queryByText(/Minimum viable OTLP body shape/)).toBeNull();
    });

    /**
     * The pane offers nothing to press, because a reader cannot make an event
     * happen from this screen — something upstream has to send one.
     * @scenario "An idle source explains itself in a pane, not in a wall of setup text"
     */
    it("offers no action", () => {
      renderUi(<EmptyEventsState />);

      expect(
        within(screen.getByTestId("source-events-empty")).queryAllByRole(
          "button",
        ),
      ).toHaveLength(0);
    });

    /**
     * Prose naming a control goes stale the moment the control is renamed, and
     * no rule about controls catches a sentence. The old paragraph told the
     * reader to click "Rotate secret".
     * @scenario "An idle source explains itself in a pane, not in a wall of setup text"
     */
    it("names no control in its sentence", () => {
      renderUi(<EmptyEventsState />);

      expect(screen.queryByText(/Rotate secret/)).toBeNull();
      expect(screen.queryByText(/Click/)).toBeNull();
    });
  });
});

describe("given the setup instructions behind the heading's (i)", () => {
  describe("when it has not been opened", () => {
    /** @scenario "Setup instructions sit behind the heading, whatever the source is doing" */
    it("shows nothing but the trigger", () => {
      renderUi(<EventsSetupPopover source={OTEL_SOURCE} />);

      expect(screen.getByTestId("events-setup-info")).toBeVisible();
      expect(screen.getByText(/Push an OTLP body to/)).not.toBeVisible();
    });
  });

  describe("when the reader opens it", () => {
    /** @scenario "Setup instructions sit behind the heading, whatever the source is doing" */
    it("shows the endpoint and the setup prose", async () => {
      const user = userEvent.setup();
      renderUi(<EventsSetupPopover source={OTEL_SOURCE} />);

      await user.click(screen.getByTestId("events-setup-info"));

      expect(await screen.findByText(/Push an OTLP body to/)).toBeVisible();
      expect(screen.getByText(ingestEndpointFor(OTEL_SOURCE))).toBeVisible();
      expect(
        screen.getByText(/Spans land in the LangWatch trace store/),
      ).toBeVisible();
      expect(screen.getByText(/copy-paste curl example/)).toBeVisible();
    });

    /**
     * The reason this is a popover and not a hover tooltip: a link inside a
     * hover-only tooltip cannot be reached by keyboard or by touch.
     * @scenario "Setup instructions sit behind the heading, whatever the source is doing"
     */
    it("puts its documentation links in the tab order", async () => {
      const user = userEvent.setup();
      renderUi(<EventsSetupPopover source={OTEL_SOURCE} />);

      await user.click(screen.getByTestId("events-setup-info"));

      const link = await screen.findByRole("link", {
        name: /Choosing the right OTel endpoint/,
      });
      expect(link.getAttribute("href")).toContain(
        "trace-vs-activity-ingestion",
      );
      // Anchors with an href are focusable; a tabindex of -1 would take it back
      // out of the tab order, which is the failure this guards.
      expect(link.getAttribute("tabindex")).not.toBe("-1");
    });

    /** @scenario "Setup instructions sit behind the heading, whatever the source is doing" */
    it("opens from the keyboard, not only from a pointer", async () => {
      const user = userEvent.setup();
      renderUi(<EventsSetupPopover source={OTEL_SOURCE} />);

      screen.getByTestId("events-setup-info").focus();
      await user.keyboard("{Enter}");

      expect(await screen.findByText(/Push an OTLP body to/)).toBeVisible();
    });
  });

  describe("when the source is not an OTel source", () => {
    /** @scenario "Setup instructions sit behind the heading, whatever the source is doing" */
    it("leaves out the OTLP body sample", async () => {
      const user = userEvent.setup();
      renderUi(
        <EventsSetupPopover source={{ id: "src_2", sourceType: "workato" }} />,
      );

      await user.click(screen.getByTestId("events-setup-info"));

      await screen.findByText(/Push an OTLP body to/);
      expect(screen.queryByText(/Minimum viable OTLP body shape/)).toBeNull();

      // The same query DOES find it once an OTel source is on screen, so the
      // absence above is a real branch rather than a typo that could never
      // have matched anything.
      renderUi(<EventsSetupPopover source={OTEL_SOURCE} />);
      expect(
        screen.queryByText(/Minimum viable OTLP body shape/),
      ).not.toBeNull();
    });
  });
});

describe("given a source's ingest endpoint", () => {
  describe("when the source type decides the mode", () => {
    /** @scenario "Setup instructions sit behind the heading, whatever the source is doing" */
    it("routes OTel sources to the otel path and webhooks to the webhook path", () => {
      expect(ingestEndpointFor(OTEL_SOURCE)).toContain(
        "/api/ingest/otel/src_1",
      );
      expect(
        ingestEndpointFor({ id: "src_2", sourceType: "workato" }),
      ).toContain("/api/ingest/webhook/src_2");
    });
  });
});
