/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import { RedactedField } from "../RedactedField";

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: vi.fn(),
}));

const mockUseFieldRedaction = vi.mocked(useFieldRedaction);

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("RedactedField", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the field is visible", () => {
    it("renders its children", () => {
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: false,
        isLoading: false,
        visibleTo: null,
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="input">hello content</RedactedField>
        </Wrapper>,
      );

      expect(container.textContent).toContain("hello content");
    });
  });

  describe("when the field is restricted to a named audience", () => {
    /** @scenario The redaction placeholder explains why content is hidden */
    it("marks it redacted and names who can see it", () => {
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: true,
        isLoading: false,
        visibleTo: "Admins, Security",
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="input">the secret</RedactedField>
        </Wrapper>,
      );

      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).toContain("visible to Admins, Security");
      expect(container.textContent).not.toContain("the secret");
    });
  });

  describe("when the field is restricted to no one", () => {
    it("says it is hidden from everyone", () => {
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: true,
        isLoading: false,
        visibleTo: "no one",
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="output">the secret</RedactedField>
        </Wrapper>,
      );

      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).toContain("hidden from everyone");
    });
  });

  describe("when redacted without an audience label", () => {
    it("falls back to the generic redacted marker", () => {
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: true,
        isLoading: false,
        visibleTo: null,
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="input">the secret</RedactedField>
        </Wrapper>,
      );

      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).not.toContain("visible to");
    });
  });
});
