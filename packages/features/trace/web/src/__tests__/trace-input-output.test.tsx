// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TraceInputOutput,
  TraceMediaStrip,
  type TraceInputOutputProps,
  type TraceMediaPartData,
} from "../index";

afterEach(cleanup);

const renderInputOutput = (overrides: Partial<TraceInputOutputProps> = {}) => {
  const copyToClipboard = vi.fn(async () => void 0);
  const onCopyFailure = vi.fn();
  const props: TraceInputOutputProps = {
    value: "plain text",
    collectMediaParts: () => [],
    renderMediaPart: () => null,
    isPythonRepr: () => false,
    parsePythonInsideJson: (value) => value,
    renderJsonViewer: (value, options) => (
      <div
        data-collapsed={`${options.collapsed}`}
        data-collapse-strings={`${options.collapseStringsAfterLength}`}
        data-testid="json-viewer"
      >
        {JSON.stringify(value)}
      </div>
    ),
    copyToClipboard,
    onCopyFailure,
    copyIcon: <>copy</>,
    renderTooltip: (_content, child) => child,
    ...overrides,
  };

  const result = render(
    <ChakraProvider value={defaultSystem}>
      <TraceInputOutput {...props} />
    </ChakraProvider>,
  );

  return { ...result, copyToClipboard, onCopyFailure };
};

describe("TraceInputOutput", () => {
  it("renders plain values without invoking the JSON viewer", () => {
    renderInputOutput();

    expect(screen.getByText("plain text")).toBeInTheDocument();
    expect(screen.queryByTestId("json-viewer")).not.toBeInTheDocument();
  });

  it("passes parsed JSON and viewer options to the controlled viewer", () => {
    renderInputOutput({
      value: '{"answer":42}',
      collapsed: true,
      collapseStringsAfterLength: 140,
    });

    const viewer = screen.getByTestId("json-viewer");
    expect(viewer).toHaveTextContent('{"answer":42}');
    expect(viewer).toHaveAttribute("data-collapsed", "true");
    expect(viewer).toHaveAttribute("data-collapse-strings", "140");
  });

  it("keeps the original payload in raw mode", () => {
    renderInputOutput({
      value: '{"original":true}',
      showTools: true,
      parsePythonInsideJson: () => ({ transformed: true }),
    });

    expect(screen.getByTestId("json-viewer")).toHaveTextContent('{"transformed":true}');

    fireEvent.click(screen.getByRole("button", { name: "{}" }));

    expect(screen.getByText(/"original": true/)).toBeInTheDocument();
    expect(screen.queryByText(/"transformed": true/)).not.toBeInTheDocument();
  });

  it("copies the original JSON representation", () => {
    const { copyToClipboard } = renderInputOutput({
      value: '{"answer":42}',
      showTools: "copy-only",
    });

    fireEvent.click(screen.getByRole("button", { name: "copy" }));

    expect(copyToClipboard).toHaveBeenCalledWith('{\n  "answer": 42\n}');
  });

  it("reports clipboard failures", async () => {
    const onCopyFailure = vi.fn();
    const copyToClipboard = vi.fn(async () => {
      throw new Error("clipboard unavailable");
    });
    renderInputOutput({
      showTools: true,
      copyToClipboard,
      onCopyFailure,
    });

    fireEvent.click(screen.getByRole("button", { name: "copy" }));

    await vi.waitFor(() => expect(onCopyFailure).toHaveBeenCalledOnce());
  });

  it("reports synchronous clipboard failures", () => {
    const onCopyFailure = vi.fn();
    renderInputOutput({
      showTools: true,
      copyToClipboard: () => {
        throw new Error("clipboard unavailable");
      },
      onCopyFailure,
    });

    fireEvent.click(screen.getByRole("button", { name: "copy" }));

    expect(onCopyFailure).toHaveBeenCalledOnce();
  });
});

describe("TraceMediaStrip", () => {
  it("bounds mounted media and reports the hidden count", () => {
    const parts: TraceMediaPartData[] = Array.from({ length: 10 }, (_, index) => ({
      type: "binary",
      mimeType: "application/octet-stream",
      filename: `file-${index}`,
    }));

    render(
      <ChakraProvider value={defaultSystem}>
        <TraceMediaStrip
          parts={parts}
          renderPart={(part) => <span>{part.type === "binary" ? part.filename : part.type}</span>}
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("file-0")).toBeInTheDocument();
    expect(screen.getByText("file-7")).toBeInTheDocument();
    expect(screen.queryByText("file-8")).not.toBeInTheDocument();
    expect(screen.getByTestId("trace-media-overflow")).toHaveTextContent(
      "+2 more media items not shown",
    );
  });
});
