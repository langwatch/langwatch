/**
 * @vitest-environment jsdom
 *
 * Editing does not fight privacy: a field the reader is not allowed to see
 * carries the redaction marker where the editor would have been, because there
 * is nothing on screen to correct.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

const { RedactedField } = await import("~/components/ui/RedactedField");
const { useTraceEditStore } = await import("../../../../stores/traceEditStore");
const { SpanEditableIO } = await import("../SpanEditableIO");

function renderInput({ redacted }: { redacted: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RedactedField field="input" redacted={redacted} visibleTo="no one">
        <SpanEditableIO
          spanId="span-1"
          field="input"
          label="Input"
          capturedText="what is the weather"
        />
      </RedactedField>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  useTraceEditStore.getState().discard();
  useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
});

afterEach(cleanup);

describe("given a span whose input is hidden from the reviewer", () => {
  describe("when the span is open in edit mode", () => {
    /** @scenario "A redacted field carries no editor" */
    it("offers no editor for it", () => {
      renderInput({ redacted: true });

      expect(screen.queryByLabelText("Edit input")).not.toBeInTheDocument();
      expect(screen.getByText("Redacted")).toBeInTheDocument();
    });
  });
});

describe("given a span whose input the reviewer can read", () => {
  describe("when the span is open in edit mode", () => {
    /** @scenario "A redacted field carries no editor" */
    it("offers the editor", () => {
      renderInput({ redacted: false });

      expect(screen.getByLabelText("Edit input")).toBeInTheDocument();
    });
  });
});
