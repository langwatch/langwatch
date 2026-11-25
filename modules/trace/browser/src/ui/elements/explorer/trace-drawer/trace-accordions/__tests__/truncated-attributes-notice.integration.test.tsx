// @vitest-environment jsdom
// Spec: specs/trace-processing/oversized-attribute-value-preview.feature
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TruncatedAttributesNotice } from "../truncated-attributes-notice.tsx";

afterEach(cleanup);

describe("TruncatedAttributesNotice", () => {
  describe("given a span that names cut attributes", () => {
    /** @scenario "The span detail says which values were cut" */
    it("names each cut attribute with its original size and surface", () => {
      renderWithDesignSystem(
        <TruncatedAttributesNotice
          attributes={[
            { key: "gen_ai.input.messages", bytes: 9_400_000 },
            { key: "gen_ai.output.messages", bytes: 300_000, on: "event" },
          ]}
        />,
      );

      const notice = screen.getByTestId("truncated-attributes-notice");
      expect(notice.textContent).toContain("too large to store and were cut");
      expect(notice.textContent).toContain("gen_ai.input.messages (9.4 MB)");
      expect(notice.textContent).toContain("gen_ai.output.messages (300.0 kB on an event)");
    });
  });

  describe("given a span that names none", () => {
    it("renders nothing", () => {
      renderWithDesignSystem(<TruncatedAttributesNotice attributes={null} />);

      expect(screen.queryByTestId("truncated-attributes-notice")).toBeNull();
    });
  });
});
