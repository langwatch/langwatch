/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StructuredOutputDisplay, tryParseJson } from "../structured-output-display";
import { PromptHostProvider } from "../../../../model/prompt-host";
import { FakePromptHost } from "../../../../testing";

/**
 * One host for the whole file: nothing here asserts on what the screen asked
 * the application to do, so a default fake is the whole composition these
 * components need. Its tab storage is in-memory, which is what keeps one case's
 * open tabs out of the next one's.
 */
const testHost = new FakePromptHost();

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
    render(
      <ChakraProvider value={defaultSystem}>
        <PromptHostProvider value={testHost}>{ui}</PromptHostProvider>
      </ChakraProvider>,
    );

  const fallback = <div data-testid="fallback">Fallback</div>;

  it("renders children while streaming", () => {
    renderWithChakra(
      <StructuredOutputDisplay content='{"score": 10}' isStreaming={true}>
        {fallback}
      </StructuredOutputDisplay>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("renders the parsed JSON when streaming completes with valid JSON", () => {
    renderWithChakra(
      <StructuredOutputDisplay content='{"score": 10}' isStreaming={false}>
        {fallback}
      </StructuredOutputDisplay>,
    );
    // The application rendered this through a collapsible JSON viewer; a
    // feature-web package may reach neither that viewer nor the four modules
    // behind it, so a structured output is pretty-printed. What the case is
    // actually about — JSON is shown instead of the raw assistant bubble — is
    // unchanged, and the fallback is gone.
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
    expect(screen.getByText(/"score": 10/)).toBeInTheDocument();
  });

  it("renders children when content is not JSON", () => {
    renderWithChakra(
      <StructuredOutputDisplay content="plain text" isStreaming={false}>
        {fallback}
      </StructuredOutputDisplay>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});
