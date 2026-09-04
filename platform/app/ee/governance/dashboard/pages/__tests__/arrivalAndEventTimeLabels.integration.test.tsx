// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The two times a source shows, and the words that keep them apart.
 *
 * A source row says when data last arrived — the moment a pull delivered
 * something. Its own page shows the time written ON the newest event, which
 * for a report covering a whole day is that day's opening minute. Both are
 * right and they are routinely hours apart, so an admin reading "last event"
 * on both screens was comparing two numbers that never agreed with nothing
 * telling them why.
 *
 * Both surfaces are rendered here rather than asserted as strings, because the
 * defect is a RELATIONSHIP between two files: only rendering both catches the
 * day somebody makes them agree again.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

import { SourceHealthCards } from "../ingestion-source-detail";
import { SourceRow } from "../inventory";

/**
 * A source whose last pull landed twenty-three minutes ago and whose newest
 * event is a daily report stamped at midnight — the exact pair that read as a
 * contradiction. Only the fields these two components touch are set.
 */
const ARRIVED_MINUTES_AGO = 23;
const sourceThatJustDelivered = {
  id: "src_admin_costs",
  name: "Vendor spend",
  description: "",
  sourceType: "openai_admin",
  status: "active",
  errorCount: 0,
  lastEventAt: new Date(Date.now() - ARRIVED_MINUTES_AGO * 60 * 1000),
} as unknown as Parameters<typeof SourceRow>[0]["source"];

/** Midnight of a day whose report arrived hours later. */
const newestEventStampedAtMidnight = {
  events24h: 4,
  events7d: 28,
  events30d: 120,
  lastSuccessIso: new Date(
    new Date().setUTCHours(0, 0, 0, 0) - 11 * 60 * 60 * 1000,
  ).toISOString(),
} as unknown as Parameters<typeof SourceHealthCards>[0]["health"];

function renderRow() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SourceRow
        source={sourceThatJustDelivered}
        isPendingRotate={false}
        isPendingArchive={false}
        onEdit={vi.fn()}
        onRotate={vi.fn()}
        onArchive={vi.fn()}
        canManage={false}
      />
    </ChakraProvider>,
  );
}

function renderHealthCards() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SourceHealthCards
        health={newestEventStampedAtMidnight}
        error={null}
        isLoading={false}
      />
    </ChakraProvider>,
  );
}

describe("given a source whose data arrives long after the day it covers", () => {
  describe("when the admin views the source list", () => {
    /** @scenario "The list says when data last arrived" */
    it("says when data last arrived, spelling the unit out", () => {
      renderRow();

      expect(
        screen.getByText(
          `· data last arrived ${ARRIVED_MINUTES_AGO} minutes ago`,
        ),
      ).toBeDefined();
    });

    /** @scenario "The list says when data last arrived" */
    it("does not call the arrival time the last event", () => {
      renderRow();

      // The word this row must not use: the source page uses it for the other
      // number, and one label across both is the whole confusion.
      expect(screen.queryByText(/last event/i)).toBeNull();
    });
  });

  describe("when the admin opens that source page", () => {
    /** @scenario "The source page names the newest event time" */
    it("names the tile for the time the newest event carries", () => {
      renderHealthCards();

      expect(screen.getByText("Newest event time")).toBeDefined();
      expect(screen.queryByText("Last event")).toBeNull();
    });

    /** @scenario "The source page names the newest event time" */
    it("explains that the time is the one on the event and not the collection time", async () => {
      const user = userEvent.setup();
      renderHealthCards();

      // Hovered rather than read off the markup: the explanation only exists
      // once the tooltip opens, so asserting it any other way would keep
      // passing after the tooltip stopped being reachable.
      await user.hover(screen.getByText("Newest event time"));

      expect(
        await screen.findByText(
          /time carried on the event itself, not the time we collected it/i,
        ),
      ).toBeDefined();
    });
  });
});
