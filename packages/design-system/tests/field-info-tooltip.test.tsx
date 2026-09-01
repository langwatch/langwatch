// @vitest-environment jsdom

/**
 * The (i) beside a field label: the label says what the setting is, the
 * popover behind the (i) carries the paragraph explaining why you would want
 * it, plus a link into the published docs.
 *
 * The docs link is the part with a history — earlier iterations passed bare
 * relative paths, which resolved against the app domain and 404'd — so every
 * href shape is asserted here.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldInfoTooltip } from "../src/components/field-info-tooltip";
import { renderWithDesignSystem } from "../src/testing";

afterEach(() => cleanup());

const openInfo = async () => {
  fireEvent.click(screen.getByRole("button", { name: "More info" }));
  return screen.findByRole("dialog");
};

const docsLink = async (label = "Read more") =>
  (await screen.findByRole("link", { name: new RegExp(label) })) as HTMLAnchorElement;

describe("FieldInfoTooltip", () => {
  describe("given a field with an explanation", () => {
    it("labels the icon-only control for assistive technology", () => {
      renderWithDesignSystem(<FieldInfoTooltip description="Which key signs it." />);

      expect(screen.getByRole("button", { name: "More info" })).toBeTruthy();
    });

    it("keeps the paragraph behind the icon until it is asked for", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip description="Which key signs outgoing requests." />,
      );

      expect(screen.queryByRole("dialog")).toBeNull();

      expect((await openInfo()).textContent).toContain(
        "Which key signs outgoing requests.",
      );
    });

    it("tells one (i) from the next when a form has several", () => {
      renderWithDesignSystem(
        <FieldInfoTooltip description="Which key signs it." testId="signing-key-info" />,
      );

      expect(screen.getByTestId("signing-key-info")).toBeTruthy();
    });
  });

  describe("given a docs path rooted at the docs site", () => {
    it("resolves it against the published docs, not the app domain", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          docHref="/ai-gateway/virtual-keys#format"
        />,
      );
      await openInfo();

      expect((await docsLink()).getAttribute("href")).toBe(
        "https://langwatch.ai/docs/ai-gateway/virtual-keys#format",
      );
    });
  });

  describe("given a bare docs path", () => {
    it("resolves it against the published docs too", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          docHref="ai-gateway/virtual-keys"
        />,
      );
      await openInfo();

      expect((await docsLink()).getAttribute("href")).toBe(
        "https://langwatch.ai/docs/ai-gateway/virtual-keys",
      );
    });
  });

  describe("given a link off the docs site", () => {
    it("passes the address through untouched", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          docHref="https://platform.openai.com/docs/api-reference"
          docLabel="OpenAI reference"
        />,
      );
      await openInfo();

      expect((await docsLink("OpenAI reference")).getAttribute("href")).toBe(
        "https://platform.openai.com/docs/api-reference",
      );
    });

    it("opens it in a new tab without handing the opener over", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          docHref="/ai-gateway/virtual-keys"
        />,
      );
      await openInfo();
      const link = await docsLink();

      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  describe("given no docs to point at", () => {
    it("shows the paragraph alone", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip description="Which key signs outgoing requests." />,
      );
      await openInfo();

      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("given a form that opted into hover", () => {
    it("opens on hover so several (i)s can be scanned without clicking", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          trigger="hover"
        />,
      );

      fireEvent.mouseEnter(screen.getByRole("button", { name: "More info" }));

      expect((await screen.findByRole("dialog")).textContent).toContain(
        "Which key signs outgoing requests.",
      );
    });

    it("refuses to close while the pointer is still on the icon", async () => {
      renderWithDesignSystem(
        <FieldInfoTooltip
          description="Which key signs outgoing requests."
          trigger="hover"
        />,
      );
      const trigger = screen.getByRole("button", { name: "More info" });

      fireEvent.mouseEnter(trigger);
      await screen.findByRole("dialog");
      // A mouse user hovers the (i) and then clicks it; the click must not
      // toggle the popover shut under the pointer that opened it.
      fireEvent.click(trigger);

      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });
});
