/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// tRPC list boundary: a personal project that has never received a trace.
vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      list: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PersonalRecentTracesTable } from "../PersonalRecentTracesTable";

function renderEmpty(slug = "acme-personal") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter>
        <PersonalRecentTracesTable projectId="p1" projectSlug={slug} />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

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

    it("links the API-key offer to the personal project's api-keys settings", () => {
      renderEmpty("jane-personal");

      const link = screen.getByText("Create an API key").closest("a");
      expect(link?.getAttribute("href")).toBe(
        "/jane-personal/settings/api-keys",
      );
    });

    it("renders the two in-page offers as buttons (scroll to the matching section)", () => {
      renderEmpty();

      expect(
        screen.getByText("Set up a coding assistant").closest("button"),
      ).toBeTruthy();
      expect(
        screen.getByText("Mint an ingestion key").closest("button"),
      ).toBeTruthy();
    });
  });
});
