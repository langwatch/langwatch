/**
 * @vitest-environment jsdom
 */
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

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("tryParseJson", () => {
  describe("returns parsed object for valid JSON objects", () => {
    it("parses simple object", () => {
      const result = tryParseJson('{"score": 10}');
      expect(result).toEqual({ score: 10 });
    });

    it("parses object with multiple keys", () => {
      const result = tryParseJson(
        '{"complete_name": "Sergio Cardenas", "score": 10}'
      );
      expect(result).toEqual({ complete_name: "Sergio Cardenas", score: 10 });
    });

    it("parses object with nested values", () => {
      const result = tryParseJson('{"data": {"inner": "value"}}');
      expect(result).toEqual({ data: { inner: "value" } });
    });

    it("parses object with boolean values", () => {
      const result = tryParseJson('{"passed": true, "failed": false}');
      expect(result).toEqual({ passed: true, failed: false });
    });

    it("parses object with null values", () => {
      const result = tryParseJson('{"value": null}');
      expect(result).toEqual({ value: null });
    });

    it("handles whitespace around JSON", () => {
      const result = tryParseJson('  {"score": 10}  ');
      expect(result).toEqual({ score: 10 });
    });

    it("handles newlines in JSON", () => {
      const result = tryParseJson('{\n  "score": 10\n}');
      expect(result).toEqual({ score: 10 });
    });
  });

  describe("returns undefined for invalid input", () => {
    it("returns undefined for undefined input", () => {
      expect(tryParseJson(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(tryParseJson("")).toBeUndefined();
    });

    it("returns undefined for plain text", () => {
      expect(tryParseJson("Hello World")).toBeUndefined();
    });

    it("returns undefined for malformed JSON", () => {
      expect(tryParseJson('{"score": }')).toBeUndefined();
    });

    it("returns undefined for JSON arrays", () => {
      expect(tryParseJson("[1, 2, 3]")).toBeUndefined();
    });

    it("returns undefined for JSON primitives", () => {
      expect(tryParseJson("42")).toBeUndefined();
      expect(tryParseJson('"string"')).toBeUndefined();
      expect(tryParseJson("true")).toBeUndefined();
      expect(tryParseJson("null")).toBeUndefined();
    });

    it("returns undefined when string does not start with {", () => {
      expect(tryParseJson("not json {key: value}")).toBeUndefined();
    });
  });
});

describe("StructuredOutputDisplay", () => {
  const fallbackContent = <div data-testid="fallback">Fallback Content</div>;

  describe("when streaming", () => {
    it("renders children during streaming", () => {
      renderWithChakra(
        <StructuredOutputDisplay content='{"score": 10}' isStreaming={true}>
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.getByTestId("fallback")).toBeInTheDocument();
      expect(screen.queryByTestId("json-tree-view")).not.toBeInTheDocument();
    });

    it("renders children even with valid JSON while streaming", () => {
      renderWithChakra(
        <StructuredOutputDisplay
          content='{"complete_name": "Test", "score": 100}'
          isStreaming={true}
        >
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.getByTestId("fallback")).toBeInTheDocument();
      expect(screen.queryByTestId("json-tree-view")).not.toBeInTheDocument();
    });
  });

  describe("when streaming is complete", () => {
    it("renders JSON tree view for valid JSON", () => {
      renderWithChakra(
        <StructuredOutputDisplay
          content='{"complete_name": "Sergio Cardenas", "score": 10}'
          isStreaming={false}
        >
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      // Should not show fallback
      expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
      // Should show the JSON tree view
      expect(screen.getByTestId("json-tree-view")).toBeInTheDocument();
    });

    it("renders children for non-JSON content", () => {
      renderWithChakra(
        <StructuredOutputDisplay
          content="Hello, this is plain text response"
          isStreaming={false}
        >
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.getByTestId("fallback")).toBeInTheDocument();
      expect(screen.queryByTestId("json-tree-view")).not.toBeInTheDocument();
    });

    it("renders children for undefined content", () => {
      renderWithChakra(
        <StructuredOutputDisplay content={undefined} isStreaming={false}>
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.getByTestId("fallback")).toBeInTheDocument();
      expect(screen.queryByTestId("json-tree-view")).not.toBeInTheDocument();
    });

    it("renders children for empty content", () => {
      renderWithChakra(
        <StructuredOutputDisplay content="" isStreaming={false}>
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.getByTestId("fallback")).toBeInTheDocument();
      expect(screen.queryByTestId("json-tree-view")).not.toBeInTheDocument();
    });

    it("renders JSON tree view for object with boolean values", () => {
      renderWithChakra(
        <StructuredOutputDisplay
          content='{"passed": true, "failed": false}'
          isStreaming={false}
        >
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
      expect(screen.getByTestId("json-tree-view")).toBeInTheDocument();
    });

    it("renders JSON tree view for object with null values", () => {
      renderWithChakra(
        <StructuredOutputDisplay content='{"value": null}' isStreaming={false}>
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
      expect(screen.getByTestId("json-tree-view")).toBeInTheDocument();
    });

    it("renders JSON tree view for nested objects", () => {
      renderWithChakra(
        <StructuredOutputDisplay
          content='{"nested": {"inner": "value"}}'
          isStreaming={false}
        >
          {fallbackContent}
        </StructuredOutputDisplay>
      );

      expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
      expect(screen.getByTestId("json-tree-view")).toBeInTheDocument();
    });
  });
});
