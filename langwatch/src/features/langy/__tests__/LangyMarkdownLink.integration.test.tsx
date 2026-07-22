/**
 * @vitest-environment jsdom
 *
 * The agent references resources in prose as markdown links built from the
 * command output's own name + platformUrl pair (AGENTS.md rule 9). These lock
 * the langy link renderer: a same-instance link rides the SPA router (the
 * persistent panel survives the move), a link that leaves the instance is
 * marked external and opens in a new tab.
 *
 * @see specs/langy/langy-live-scenario-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { Markdown } from "~/components/Markdown";

const DRAWER_URL =
  "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1";

function renderLangyMarkdown(text: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Markdown fontSize="13px" linkVariant="langy">
        {text}
      </Markdown>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { origin: "https://app.langwatch.ai" },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("Feature: a resource in the agent's prose reads as a named link, never a raw address", () => {
  describe("given the reply references a resource as a markdown link with the platform's own address", () => {
    /** @scenario "A platform link in the reply opens in place" */
    it("moves in-app via the SPA router, never a full page load", () => {
      renderLangyMarkdown(
        `Opened [Refuses unrelated request](${DRAWER_URL}).`,
      );

      const link = screen.getByText("Refuses unrelated request");
      fireEvent.click(link);

      expect(pushMock).toHaveBeenCalledWith(
        "/acme/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
      // In-app: no external marker, no new tab.
      expect(link.closest("a")!.getAttribute("target")).toBeNull();
      expect(
        screen.queryByLabelText(/opens outside LangWatch/i),
      ).toBeNull();
    });

    it("leaves modifier clicks to the browser's native new-tab behavior", () => {
      renderLangyMarkdown(`Opened [The run](${DRAWER_URL}).`);

      fireEvent.click(screen.getByText("The run"), { metaKey: true });
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe("when the reply carries a link to an address outside this instance", () => {
    /** @scenario "A link that leaves this LangWatch instance is marked external" */
    it("marks the link as leaving the app and opens it outside the conversation", () => {
      renderLangyMarkdown("See [the docs](https://langwatch.ai/docs).");

      const anchor = screen.getByText("the docs").closest("a")!;
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toContain("noopener");
      expect(
        screen.getByLabelText(/opens outside LangWatch/i),
      ).toBeDefined();

      fireEvent.click(screen.getByText("the docs"));
      // Never hijacked into the SPA router — the app must not navigate away.
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
