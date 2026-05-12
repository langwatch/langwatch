/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { slug: "acme" },
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { PIIRedactionNotice } from "../PIIRedactionNotice";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("PIIRedactionNotice", () => {
  afterEach(cleanup);

  describe("when content carries no redaction marker", () => {
    it("renders nothing", () => {
      const { container } = render(
        <Wrapper>
          <PIIRedactionNotice content="say hi" />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("when content contains [REDACTED]", () => {
    it("renders the banner with a Settings link", () => {
      render(
        <Wrapper>
          <PIIRedactionNotice content="my name is [REDACTED] from somewhere" />
        </Wrapper>,
      );
      expect(
        screen.getByText(/redacted by this project's PII redaction/i),
      ).toBeTruthy();
      const link = screen.getByRole("link", {
        name: /Settings → PII Redaction/i,
      });
      expect(link.getAttribute("href")).toBe("/acme/settings");
    });
  });

  describe("when content is null or undefined", () => {
    it("renders nothing for null", () => {
      const { container } = render(
        <Wrapper>
          <PIIRedactionNotice content={null} />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });

    it("renders nothing for undefined", () => {
      const { container } = render(
        <Wrapper>
          <PIIRedactionNotice content={undefined} />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });
});
