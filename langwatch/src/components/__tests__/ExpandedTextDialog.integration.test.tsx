/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ExpandedTextDialog } from "../HoverableBigText";

vi.mock("@microlink/react-json-view", () => ({
  __esModule: true,
  default: ({ src }: { src: object }) => (
    <pre data-testid="react-json-view">{JSON.stringify(src, null, 2)}</pre>
  ),
}));

vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: unknown }>) => {
    let Component: React.ComponentType<Record<string, unknown>> | null = null;
    const promise = loader();
    promise.then((mod) => {
      Component = mod.default as React.ComponentType<Record<string, unknown>>;
    });
    return function DynamicComponent(props: Record<string, unknown>) {
      if (Component) return <Component {...props} />;
      return <div />;
    };
  },
}));

const DIALOG_BODY_SELECTOR = ".chakra-dialog__body";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDialog({
  text,
  open = true,
}: {
  text: string;
  open?: boolean;
}) {
  return render(
    <ExpandedTextDialog
      open={open}
      onOpenChange={() => {}}
      textExpanded={text}
    />,
    { wrapper: Wrapper },
  );
}

function findDialogBody(baseElement: HTMLElement) {
  return baseElement.querySelector(DIALOG_BODY_SELECTOR);
}

const LARGE_JSON = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [
      `key${i}`,
      `value${i} - ${"x".repeat(100)}`,
    ]),
  ),
);

const SMALL_JSON = JSON.stringify({ hello: "world" });

const LARGE_PLAIN_TEXT = "Line of text\n".repeat(500);

const LARGE_MARKDOWN = Array.from(
  { length: 200 },
  (_, i) => `## Heading ${i}\n\nParagraph content here.\n`,
).join("\n");

describe("<ExpandedTextDialog/>", () => {
  describe("when content exceeds the dialog viewport height", () => {
    it("makes large JSON content accessible within the dialog body", () => {
      const { baseElement } = renderDialog({ text: LARGE_JSON });

      const dialogBody = findDialogBody(baseElement);
      expect(dialogBody).toBeTruthy();

      const style = window.getComputedStyle(dialogBody as Element);
      expect(style.overflow).toBe("auto");
      expect(style.maxHeight).toBeTruthy();
    });

    it("makes large plain text accessible within the dialog body", () => {
      const { baseElement } = renderDialog({ text: LARGE_PLAIN_TEXT });

      const dialogBody = findDialogBody(baseElement);
      expect(dialogBody).toBeTruthy();

      const style = window.getComputedStyle(dialogBody as Element);
      expect(style.overflow).toBe("auto");
    });

    it("makes large Markdown content accessible within the dialog body", () => {
      const { baseElement } = renderDialog({ text: LARGE_MARKDOWN });

      const dialogBody = findDialogBody(baseElement);
      expect(dialogBody).toBeTruthy();

      const style = window.getComputedStyle(dialogBody as Element);
      expect(style.overflow).toBe("auto");
    });
  });

  describe("when content fits within the dialog viewport", () => {
    it("does not force scrolling for small content", () => {
      const { baseElement } = renderDialog({ text: SMALL_JSON });

      const dialogBody = findDialogBody(baseElement);
      expect(dialogBody).toBeTruthy();

      // overflow: auto only shows scrollbars when content overflows,
      // so small content will not scroll even with overflow: auto set
      const style = window.getComputedStyle(dialogBody as Element);
      expect(style.overflow).toBe("auto");
    });
  });

  describe("when JSON content is displayed with formatted mode enabled", () => {
    it("renders the copy button within the dialog", () => {
      const { baseElement } = renderDialog({
        text: JSON.stringify({ nested: { key: "value" } }),
      });

      // The RenderInputOutput component renders a copy button
      const copyButton = baseElement.querySelector("button svg");
      expect(copyButton).toBeTruthy();
    });
  });

  describe("when toggling the formatted switch off", () => {
    it("keeps the dialog body scrollable after toggling", () => {
      const { baseElement } = render(
        <ExpandedTextDialog
          open={true}
          onOpenChange={() => {}}
          textExpanded={LARGE_JSON}
        />,
        { wrapper: Wrapper },
      );

      // Toggle the formatted switch off
      const switchInput = baseElement.querySelector("input[type='checkbox']");
      expect(switchInput).toBeTruthy();
      fireEvent.click(switchInput as Element);

      const dialogBody = findDialogBody(baseElement);
      expect(dialogBody).toBeTruthy();

      const style = window.getComputedStyle(dialogBody as Element);
      expect(style.overflow).toBe("auto");
    });
  });
});
