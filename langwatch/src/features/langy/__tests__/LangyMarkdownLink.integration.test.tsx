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

// Same-origin stub for the guard's origin comparison — restored after each
// test so the shared jsdom window never leaks a bare-object location.
// `protocol` and `host` are carried too, not just `origin`: resolving a
// protocol-relative `//host/path` borrows the page's scheme, so a stub missing
// them silently resolves to `undefined//host` and every such link reads as
// external.
const realLocation = window.location;
const STUB_ORIGIN = "https://app.langwatch.ai";
const STUB_HOST = "app.langwatch.ai";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { origin: STUB_ORIGIN, protocol: "https:", host: STUB_HOST },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: realLocation,
    writable: true,
    configurable: true,
  });
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

    it("never treats a backslash-disguised protocol-relative href as internal", () => {
      // Browsers normalise `\\` to `/`, so `/\\evil.com` resolves as the
      // protocol-relative `//evil.com` — an off-site jump wearing a leading
      // slash. Markdown's urlTransform percent-encodes the backslash to
      // `%5C` before the guard ever sees it, so the ENCODED disguise must be
      // rejected exactly like the raw byte: never SPA-pushed.
      renderLangyMarkdown("Click [here](/\\evil.com).");

      fireEvent.click(screen.getByText("here"));
      expect(pushMock).not.toHaveBeenCalled();
    });

    /**
     * A protocol-relative href carries no scheme, so a `^https?://` test calls
     * it "not absolute" — while the guard separately refuses to treat it as
     * in-app. Landing in neither bucket, it used to render as a bare anchor:
     * off-site, in the same tab, with nothing telling the reader it left.
     */
    it("marks a bare protocol-relative href as leaving the app", () => {
      renderLangyMarkdown("Go [away](//evil.example.com).");

      const anchor = screen.getByText("away").closest("a")!;
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toContain("noopener");
    });

    it("never SPA-pushes a bare protocol-relative href", () => {
      renderLangyMarkdown("Go [away](//evil.example.com).");

      fireEvent.click(screen.getByText("away"));
      expect(pushMock).not.toHaveBeenCalled();
    });

    /**
     * The same-origin case must still ride the SPA router: Langy writes its
     * links absolute, and a `//this-host/path` form is the same destination as
     * `/path` — treating every protocol-relative href as external would tear
     * the panel down on a link to this very instance.
     */
    it("keeps a protocol-relative link to this instance in the SPA", () => {
      renderLangyMarkdown(`Open [the run](//${STUB_HOST}/acme/simulations).`);

      const anchor = screen.getByText("the run").closest("a")!;
      expect(anchor.getAttribute("target")).not.toBe("_blank");

      fireEvent.click(screen.getByText("the run"));
      expect(pushMock).toHaveBeenCalledWith("/acme/simulations");
    });
  });
});
