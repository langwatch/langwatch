/**
 * @vitest-environment jsdom
 *
 * Links inside the Langy panel, clicked for real: the panel root's guard, the
 * dialog it opens, and the answer's own markdown links rendered exactly as the
 * panel renders them.
 *
 * The links here are written the way an agent writes them, including the ones
 * whose words say LangWatch and whose address does not.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { Markdown } from "~/components/Markdown";
import { LangyExternalLinkDialog } from "../components/LangyExternalLinkDialog";
import {
  langyFirstPartyLinkProps,
  useLangyExternalLinkGuard,
} from "../hooks/useLangyExternalLinkGuard";

/** What the browser would have done with the clicks the guard let through. */
const navigation = { attempts: 0 };

/**
 * The panel root's wiring, in miniature: the guard's props on the root element
 * and the dialog beside it, exactly as LangyPanel mounts them.
 */
function LangyPanelHarness({ answer }: { answer: string }) {
  const guard = useLangyExternalLinkGuard();
  return (
    <ChakraProvider value={defaultSystem}>
      <div
        data-testid="panel-root"
        {...guard.guardProps}
        // Bubble phase, so it runs after the guard: stands in for the browser
        // actually leaving, and records whether the guard let the click go.
        onClick={(event) => {
          if (!event.defaultPrevented) navigation.attempts += 1;
          event.preventDefault();
        }}
      >
        <Markdown linkVariant="langy">{answer}</Markdown>
      </div>
      <LangyExternalLinkDialog {...guard.dialogProps} />
    </ChakraProvider>
  );
}

function renderAnswer(answer: string) {
  return render(<LangyPanelHarness answer={answer} />);
}

const whenClicked = (text: string, init?: MouseEventInit) => {
  const link = screen.getByText(text);
  fireEvent.click(link, init);
  return link;
};

const whenMiddleClicked = (text: string) => {
  const link = screen.getByText(text);
  // No fireEvent shorthand for the middle-click event React reads as
  // `onAuxClick`, so it is dispatched the way the browser dispatches it.
  fireEvent(
    link,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
  );
  return link;
};

const theDialog = () => screen.findByRole("dialog");
const noDialog = () => screen.queryByRole("dialog");
const destination = () => screen.getByTestId("langy-external-link-host");

/** Let the interception (and any dialog it would open) settle. */
async function settle() {
  await waitFor(() => expect(true).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  navigation.attempts = 0;
  vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(async () => {
  // Close the dialog the polite way before tearing the page down. Unmounting an
  // open modal leaves it on the overlay stack the dialog library keeps across
  // renders, and the next dialog is then never the top one: no Escape, no
  // focus handed back.
  const stay = screen.queryByRole("button", { name: "Stay here" });
  if (stay) {
    fireEvent.click(stay);
    await waitFor(() => expect(noDialog()).toBeNull());
  }
  cleanup();
  pushMock.mockClear();
  vi.restoreAllMocks();
});

describe("given an answer linking somewhere that is not LangWatch", () => {
  describe("when the link is clicked", () => {
    /** @scenario Clicking an off-site link asks first */
    it("shows where it goes instead of opening it", async () => {
      renderAnswer("See [the pricing page](https://example.com/pricing).");
      whenClicked("the pricing page");

      await theDialog();
      expect(destination().textContent).toBe("example.com");
      expect(window.open).not.toHaveBeenCalled();
      expect(navigation.attempts).toBe(0);
    });

    /** @scenario Clicking an off-site link asks first */
    it("shows the whole address under the host", async () => {
      renderAnswer("See [the pricing page](https://example.com/pricing).");
      whenClicked("the pricing page");

      await theDialog();
      expect(screen.getByTestId("langy-external-link-url").textContent).toBe(
        "https://example.com/pricing",
      );
    });
  });

  describe("when the words on the link name a LangWatch address", () => {
    /** @scenario The dialog reads the address, never the link's words */
    it("names the host the address really points at", async () => {
      renderAnswer(
        "[https://docs.langwatch.ai/setup](https://evil.example/login)",
      );
      whenClicked("https://docs.langwatch.ai/setup");

      await theDialog();
      expect(destination().textContent).toBe("evil.example");
    });

    /** @scenario The dialog reads the address, never the link's words */
    it("does not repeat the words as if they were the destination", async () => {
      renderAnswer(
        "[https://docs.langwatch.ai/setup](https://evil.example/login)",
      );
      whenClicked("https://docs.langwatch.ai/setup");

      const dialog = await theDialog();
      expect(dialog.textContent).not.toContain("docs.langwatch.ai");
    });
  });

  describe("when the address hides the real host behind a trusted-looking prefix", () => {
    it("names the host the browser will contact", async () => {
      renderAnswer("[Sign in](https://langwatch.ai@evil.example/login)");
      whenClicked("Sign in");

      await theDialog();
      expect(destination().textContent).toBe("evil.example");
    });
  });

  describe("when the dialog opens", () => {
    it("puts staying under the reader's fingers", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      whenClicked("Pricing");

      await theDialog();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Stay here" }),
        ),
      );
    });
  });

  describe("when the reader chooses to stay", () => {
    /** @scenario Staying keeps me where I am */
    it("opens nothing", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      whenClicked("Pricing");

      await theDialog();
      fireEvent.click(screen.getByRole("button", { name: "Stay here" }));

      await waitFor(() => expect(noDialog()).toBeNull());
      expect(window.open).not.toHaveBeenCalled();
    });

    /** @scenario Staying keeps me where I am */
    it("puts the reader back on the link they clicked", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      const link = whenClicked("Pricing");

      await theDialog();
      fireEvent.click(screen.getByRole("button", { name: "Stay here" }));

      await waitFor(() => expect(document.activeElement).toBe(link));
    });
  });

  describe("when Escape is pressed", () => {
    /** @scenario Escape closes the dialog without opening anything */
    it("closes without opening anything", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      whenClicked("Pricing");

      await theDialog();
      // Escape only counts once the dialog is ready to hear it. Focus landing
      // on "Stay here" is the dialog's own "I am wired up" signal; pressing
      // before that races the dismissable layer's listener under load.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Stay here" }),
        ),
      );
      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(noDialog()).toBeNull());
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe("when the reader chooses to open it", () => {
    /** @scenario Continuing opens the destination */
    it("opens the destination in a new tab, with no handle back into the app", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      whenClicked("Pricing");

      await theDialog();
      fireEvent.click(
        screen.getByRole("button", { name: /Open example\.com/ }),
      );

      expect(window.open).toHaveBeenCalledWith(
        "https://example.com/pricing",
        "_blank",
        "noopener,noreferrer",
      );
      await waitFor(() => expect(noDialog()).toBeNull());
    });
  });

  describe("when the dialog is open", () => {
    /** @scenario There is no way to stop being asked */
    it("offers only staying or opening the destination", async () => {
      renderAnswer("[Pricing](https://example.com/pricing)");
      whenClicked("Pricing");

      await theDialog();
      const labels = screen
        .getAllByRole("button")
        .map((button) => button.textContent ?? "");
      expect(labels).toHaveLength(2);
      expect(labels).toContain("Stay here");
      expect(labels.some((label) => label.startsWith("Open example.com"))).toBe(
        true,
      );
      expect(labels.some((label) => /again|always|trust/i.test(label))).toBe(
        false,
      );
    });
  });
});

describe("given the link is opened by something other than a plain click", () => {
  /** @scenario Every way of opening a link is checked */
  it.each([
    ["holding cmd", { metaKey: true }],
    ["holding ctrl", { ctrlKey: true }],
    ["holding shift", { shiftKey: true }],
    ["activating it from the keyboard", { detail: 0 }],
  ])("checks the destination when %s", async (_gesture, init) => {
    renderAnswer("[Pricing](https://example.com/pricing)");
    whenClicked("Pricing", init);

    await theDialog();
    expect(destination().textContent).toBe("example.com");
    expect(window.open).not.toHaveBeenCalled();
  });

  /** @scenario Every way of opening a link is checked */
  it("checks the destination on a middle click", async () => {
    renderAnswer("[Pricing](https://example.com/pricing)");
    whenMiddleClicked("Pricing");

    await theDialog();
    expect(destination().textContent).toBe("example.com");
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("given a link that opens in a new tab of its own accord", () => {
  /** @scenario A link marked to open in a new tab is checked too */
  it("is checked like any other", async () => {
    // Every off-site markdown link Langy renders carries target="_blank", so a
    // page-unload guard would never see one of them.
    renderAnswer("[Pricing](https://example.com/pricing)");
    expect(screen.getByText("Pricing").closest("a")?.target).toBe("_blank");

    whenClicked("Pricing");
    await theDialog();
  });
});

describe("given a LangWatch destination", () => {
  describe("when an in-app link is clicked", () => {
    /** @scenario A link into the app opens straight away */
    it("navigates without stopping to ask", async () => {
      renderAnswer("[The failing trace](/my-project/messages/abc123)");
      whenClicked("The failing trace");

      await waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith("/my-project/messages/abc123"),
      );
      await settle();
      expect(noDialog()).toBeNull();
    });
  });

  describe("when a documentation link is clicked", () => {
    /** @scenario A link to the LangWatch documentation opens straight away */
    it("opens without stopping to ask", async () => {
      renderAnswer("[Setting up](https://docs.langwatch.ai/introduction)");
      whenClicked("Setting up");

      await settle();
      expect(noDialog()).toBeNull();
      expect(navigation.attempts).toBe(1);
    });
  });

  describe("when an email link is clicked", () => {
    /** @scenario A link that is not a web address is left alone */
    it("is left to the browser", async () => {
      renderAnswer("[Email us](mailto:support@langwatch.ai)");
      whenClicked("Email us");

      await settle();
      expect(noDialog()).toBeNull();
      expect(navigation.attempts).toBe(1);
    });
  });
});

describe("given a link that is not a place to go", () => {
  it("refuses an inline document without offering to open it", async () => {
    renderAnswer("[Read this](data:text/html,<h1>hi</h1>)");
    whenClicked("Read this");

    await settle();
    expect(noDialog()).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
    expect(navigation.attempts).toBe(0);
  });
});

/**
 * The panel's own chrome beside an answer linking to the very same address:
 * the codex sign-in's "Open openai.com" button, in miniature. The chrome link
 * carries the first-party marker a LangWatch component spells out; the answer
 * cannot (the markdown pipeline emits no data attributes on anchors).
 */
function ChromeAndAnswerHarness() {
  const guard = useLangyExternalLinkGuard();
  return (
    <ChakraProvider value={defaultSystem}>
      <div
        data-testid="panel-root"
        {...guard.guardProps}
        onClick={(event) => {
          if (!event.defaultPrevented) navigation.attempts += 1;
          event.preventDefault();
        }}
      >
        <a
          href="https://auth.openai.com/device"
          target="_blank"
          rel="noopener noreferrer"
          {...langyFirstPartyLinkProps}
        >
          Open openai.com
        </a>
        <Markdown linkVariant="langy">
          {"[the device page](https://auth.openai.com/device)"}
        </Markdown>
      </div>
      <LangyExternalLinkDialog {...guard.dialogProps} />
    </ChakraProvider>
  );
}

describe("given the panel's own chrome links off-site", () => {
  beforeEach(() => {
    render(<ChromeAndAnswerHarness />);
  });

  describe("when the first-party button is clicked", () => {
    /** @scenario A button of LangWatch's own that leaves the app opens straight away */
    it("opens with no dialog in between", async () => {
      whenClicked("Open openai.com");

      await settle();
      expect(noDialog()).toBeNull();
      expect(navigation.attempts).toBe(1);
    });
  });

  describe("when an answer links to the same address", () => {
    /** @scenario An answer linking to the same address is still checked */
    it("is still stopped and read out first", async () => {
      whenClicked("the device page");

      await theDialog();
      expect(destination().textContent).toBe("auth.openai.com");
      expect(window.open).not.toHaveBeenCalled();
      expect(navigation.attempts).toBe(0);
    });
  });
});
