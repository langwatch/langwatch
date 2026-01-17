/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the RenderInputOutput component which uses dynamic imports
vi.mock("~/components/traces/RenderInputOutput", () => ({
  RenderInputOutput: ({ value }: { value: object }) => (
    <div data-testid="json-tree-view">{JSON.stringify(value, null, 2)}</div>
  ),
}));

import {
  StructuredOutputDisplay,
  tryParseJson,
} from "../StructuredOutputDisplay";

afterEach(() => {
  cleanup();
});

describe("tryParseJson", () => {
  it.each([
    ['{"score": 10}', { score: 10 }],
    ['{"complete_name": "Sergio", "score": 10}', { complete_name: "Sergio", score: 10 }],
    ['{"data": {"inner": "value"}}', { data: { inner: "value" } }],
    ['{"passed": true}', { passed: true }],
    ['{"value": null}', { value: null }],
    ['  {"score": 10}  ', { score: 10 }],
  ])("parses valid JSON object: %s", (input, expected) => {
    expect(tryParseJson(input)).toEqual(expected);
  });

  it.each([
    [undefined, "undefined input"],
    ["", "empty string"],
    ["Hello World", "plain text"],
    ['{"score": }', "malformed JSON"],
    ["[1, 2, 3]", "array"],
    ["42", "number primitive"],
    ["not json {}", "non-JSON prefix"],
  ])("returns undefined for %s", (input, _description) => {
    expect(tryParseJson(input)).toBeUndefined();
  });
});

describe("StructuredOutputDisplay", () => {
  const renderWithChakra = (ui: ReactElement) =>
    render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

  const fallback = <div data-testid="fallback">Fallback</div>;

  it("renders children while streaming", () => {
    renderWithChakra(
      <StructuredOutputDisplay content='{"score": 10}' isStreaming={true}>
        {fallback}
      </StructuredOutputDisplay>
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("renders JSON tree when streaming completes with valid JSON", () => {
    renderWithChakra(
      <StructuredOutputDisplay content='{"score": 10}' isStreaming={false}>
        {fallback}
      </StructuredOutputDisplay>
    );
    expect(screen.getByTestId("json-tree-view")).toBeInTheDocument();
  });

  it("renders children when content is not JSON", () => {
    renderWithChakra(
      <StructuredOutputDisplay content="plain text" isStreaming={false}>
        {fallback}
      </StructuredOutputDisplay>
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});
