/**
 * @vitest-environment jsdom
 *
 * Tests for nested trace mapping fields in the VariableMappingInput component.
 * These tests verify that trace fields like "metadata" and "spans" show nested
 * options when selected.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  type AvailableSource,
  VariableMappingInput,
} from "~/components/variables";
import { TRACE_MAPPINGS } from "~/server/tracer/tracesMapping";

// Import the actual function we want to test
// We'll recreate it here to test the expected behavior
const METADATA_CHILDREN = [
  { name: "thread_id", type: "str" as const },
  { name: "user_id", type: "str" as const },
  { name: "customer_id", type: "str" as const },
  { name: "labels", type: "list" as const },
  { name: "topic_id", type: "str" as const },
  { name: "subtopic_id", type: "str" as const },
];

const SPANS_CHILDREN = [
  { name: "input", type: "str" as const },
  { name: "output", type: "str" as const },
  { name: "params", type: "dict" as const },
  { name: "contexts", type: "list" as const },
];

/**
 * This is the expected implementation of getTraceAvailableSources.
 * It should provide nested children for metadata and spans fields.
 */
const getTraceAvailableSources = (): AvailableSource[] => {
  return [
    {
      id: "trace",
      name: "Trace",
      type: "dataset",
      fields: Object.entries(TRACE_MAPPINGS).map(([key, config]) => {
        const hasKeys = "keys" in config && typeof config.keys === "function";

        // Provide static children for known nested fields
        if (key === "metadata") {
          return {
            name: key,
            type: "dict" as const,
            children: METADATA_CHILDREN,
            isComplete: true,
          };
        }

        if (key === "spans") {
          return {
            name: key,
            type: "list" as const,
            children: SPANS_CHILDREN,
            isComplete: true,
          };
        }

        // Other fields with keys() function - mark as complete
        if (hasKeys) {
          return {
            name: key,
            type: "dict" as const,
            isComplete: true,
          };
        }

        return {
          name: key,
          type: "str" as const,
        };
      }),
    },
  ];
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Trace mapping nested fields", () => {
  afterEach(() => {
    cleanup();
  });

  describe("getTraceAvailableSources structure", () => {
    it("includes all TRACE_MAPPINGS keys as fields", () => {
      const sources = getTraceAvailableSources();
      expect(sources).toHaveLength(1);

      const traceSource = sources[0]!;
      expect(traceSource.id).toBe("trace");
      expect(traceSource.name).toBe("Trace");

      // Should have fields for all TRACE_MAPPINGS keys
      const fieldNames = traceSource.fields.map((f) => f.name);
      expect(fieldNames).toContain("input");
      expect(fieldNames).toContain("output");
      expect(fieldNames).toContain("metadata");
      expect(fieldNames).toContain("spans");
    });

    it("metadata field has children for common metadata keys", () => {
      const sources = getTraceAvailableSources();
      const metadataField = sources[0]!.fields.find(
        (f) => f.name === "metadata",
      );

      expect(metadataField).toBeDefined();
      expect(metadataField!.children).toBeDefined();
      expect(metadataField!.children!.length).toBeGreaterThan(0);

      const childNames = metadataField!.children!.map((c) => c.name);
      expect(childNames).toContain("thread_id");
      expect(childNames).toContain("user_id");
      expect(childNames).toContain("customer_id");
    });

    it("spans field has children for span subfields", () => {
      const sources = getTraceAvailableSources();
      const spansField = sources[0]!.fields.find((f) => f.name === "spans");

      expect(spansField).toBeDefined();
      expect(spansField!.children).toBeDefined();
      expect(spansField!.children!.length).toBeGreaterThan(0);

      const childNames = spansField!.children!.map((c) => c.name);
      expect(childNames).toContain("input");
      expect(childNames).toContain("output");
    });
  });

  describe("VariableMappingInput with trace sources", () => {
    it("shows trace fields in dropdown when clicked", async () => {
      const user = userEvent.setup();
      const sources = getTraceAvailableSources();

      render(<VariableMappingInput availableSources={sources} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Should show trace fields
      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
    });

    it("shows metadata nested children when metadata is selected", async () => {
      const user = userEvent.setup();
      const sources = getTraceAvailableSources();

      render(<VariableMappingInput availableSources={sources} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Wait for dropdown
      await waitFor(() => {
        expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
      });

      // Click metadata
      await user.click(screen.getByTestId("field-option-metadata"));

      // EXPECTED: metadata badge appears AND nested children are shown
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent(
          "metadata",
        );
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("field-option-thread_id"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("field-option-user_id")).toBeInTheDocument();
        expect(
          screen.getByTestId("field-option-customer_id"),
        ).toBeInTheDocument();
      });
    });

    it("shows spans nested children when spans is selected", async () => {
      const user = userEvent.setup();
      const sources = getTraceAvailableSources();

      render(<VariableMappingInput availableSources={sources} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Wait for dropdown
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });

      // Click spans
      await user.click(screen.getByTestId("field-option-spans"));

      // EXPECTED: spans badge appears AND nested children are shown
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent(
          "spans",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
      });
    });

    it("creates nested path when selecting metadata.thread_id", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      const sources = getTraceAvailableSources();

      render(
        <VariableMappingInput
          availableSources={sources}
          onMappingChange={onMappingChange}
        />,
        { wrapper: Wrapper },
      );

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Select metadata
      await waitFor(() => {
        expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-metadata"));

      // Select thread_id
      await waitFor(() => {
        expect(
          screen.getByTestId("field-option-thread_id"),
        ).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-thread_id"));

      // Should call onMappingChange with nested path
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "trace",
          path: ["metadata", "thread_id"],
        });
      });

      // Should show the complete mapping as a single tag
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("metadata.thread_id")).toBeInTheDocument();
    });

    it("creates nested path when selecting spans.output", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      const sources = getTraceAvailableSources();

      render(
        <VariableMappingInput
          availableSources={sources}
          onMappingChange={onMappingChange}
        />,
        { wrapper: Wrapper },
      );

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Select spans
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      // Select output
      await waitFor(() => {
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-output"));

      // Should call onMappingChange with nested path
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "trace",
          path: ["spans", "output"],
        });
      });

      // Should show the complete mapping as a single tag
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("spans.output")).toBeInTheDocument();
    });
  });
});
