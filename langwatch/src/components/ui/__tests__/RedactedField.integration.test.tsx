/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import { RedactedField, RedactedInline } from "../RedactedField";

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: vi.fn(),
}));

const hasPermission = vi.fn((_permission: string) => true);
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    hasPermission: (permission: string) => hasPermission(permission),
  }),
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
    it("points at privacy settings instead of a bare audience", () => {
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
      expect(container.textContent).toContain("hidden by privacy settings");
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

  // The traces-v2 drawer drives redaction from the DTO's own flags via the
  // `redacted` prop instead of the per-field query, so the marker can never
  // disagree with the content the server already nulled.
  describe("when an explicit redacted prop is provided", () => {
    it("wins over the per-field query result", () => {
      // The query says NOT redacted; the explicit prop says redacted — the
      // explicit prop must win and render the marker.
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: false,
        isLoading: false,
        visibleTo: null,
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="input" redacted visibleTo="Admins">
            the secret
          </RedactedField>
        </Wrapper>,
      );

      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).toContain("visible to Admins");
      expect(container.textContent).not.toContain("the secret");
    });

    it("renders children when the explicit prop says not redacted", () => {
      // The query says redacted; the explicit `false` prop must still win and
      // show the content.
      mockUseFieldRedaction.mockReturnValue({
        isRedacted: true,
        isLoading: false,
        visibleTo: "Admins",
      });

      const { container } = render(
        <Wrapper>
          <RedactedField field="input" redacted={false}>
            visible content
          </RedactedField>
        </Wrapper>,
      );
      expect(container.textContent).toContain("visible content");
      expect(container.textContent).not.toContain("Redacted");
    });
  });
});

describe("RedactedInline", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when given a named audience", () => {
    it("renders the lock + Redacted marker with the audience hint", () => {
      const { container } = render(
        <Wrapper>
          <RedactedInline visibleTo="Admins" />
        </Wrapper>,
      );
      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).toContain("visible to Admins");
    });
  });

  describe("when given no audience", () => {
    it("renders the generic marker", () => {
      const { container } = render(
        <Wrapper>
          <RedactedInline />
        </Wrapper>,
      );
      expect(container.textContent).toContain("Redacted");
      expect(container.textContent).not.toContain("visible to");
    });
  });
});
