/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

    it("ignores ordinary bracketed text that is not a marker", () => {
      const { container } = render(
        <Wrapper>
          <PIIRedactionNotice content="[INFO] the job started" />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("when content carries a typed redaction marker", () => {
    it("renders the banner with a Settings link for a PII marker", () => {
      render(
        <Wrapper>
          <PIIRedactionNotice content="reach me at [EMAIL_ADDRESS] anytime" />
        </Wrapper>,
      );
      expect(
        screen.getByText(/redacted by this project's privacy settings/i),
      ).toBeTruthy();
      const link = screen.getByRole("link", {
        name: /Settings/i,
      });
      // The banner names privacy settings, so it links to the page that
      // holds them. Settings is a top-level route: a project-slug prefix
      // has no route behind it and lands the reader on a 404 or, for a
      // member whose ambient team resolves elsewhere, on a refusal.
      expect(link.getAttribute("href")).toBe("/settings/data-privacy");
    });

    it("renders the banner for a secret marker", () => {
      render(
        <Wrapper>
          <PIIRedactionNotice content="authorization: [SECRET]" />
        </Wrapper>,
      );
      expect(
        screen.getByText(/redacted by this project's privacy settings/i),
      ).toBeTruthy();
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
