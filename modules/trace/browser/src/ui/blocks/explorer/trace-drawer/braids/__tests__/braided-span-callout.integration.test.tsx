/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { SpanBraid } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BraidedSpanCallout } from "../braided-span-callout.tsx";

afterEach(cleanup);

function braid(over: Partial<SpanBraid> = {}): SpanBraid {
  return {
    ownerProjectId: "specialists",
    ownerName: "Specialists",
    canOpenOwner: false,
    matchedConditions: ['attributes["orchestrator"] == "web"'],
    signedBy: null,
    ...over,
  };
}

describe("BraidedSpanCallout", () => {
  describe("given a span braided in under a condition", () => {
    /** @scenario "Actions that would act on the owner's data are off on a braided span, with a reason" */
    it("says where it came from and the condition it matched", () => {
      renderWithDesignSystem(<BraidedSpanCallout braid={braid()} ownerHref={null} />);

      expect(screen.getByText("Braided from Specialists")).toBeInTheDocument();
      expect(screen.getByTestId("braided-span-callout")).toHaveTextContent(
        'Shown because it matches attributes["orchestrator"] == "web".',
      );
    });
  });

  describe("given a braid that shares every span of the owner", () => {
    it("says so instead of naming a condition", () => {
      renderWithDesignSystem(
        <BraidedSpanCallout braid={braid({ matchedConditions: [] })} ownerHref={null} />,
      );

      expect(screen.getByTestId("braided-span-callout")).toHaveTextContent(
        "Shown because a braid shares every span of Specialists in this trace.",
      );
    });
  });

  describe("given a signed call", () => {
    it("names the project that signed it", () => {
      renderWithDesignSystem(
        <BraidedSpanCallout
          braid={braid({ signedBy: { projectId: "orchestrator", name: "Web orchestrator" } })}
          ownerHref={null}
        />,
      );

      expect(screen.getByTestId("braided-span-callout")).toHaveTextContent(
        "Signed by Web orchestrator.",
      );
    });
  });

  describe("given a viewer who cannot open the owner project", () => {
    /** @scenario "Opening the owner project is offered only to someone who can open it" */
    it("offers no link to it", () => {
      renderWithDesignSystem(
        <BraidedSpanCallout braid={braid({ canOpenOwner: false })} ownerHref="/specialists" />,
      );

      expect(screen.queryByRole("link", { name: /Open in Specialists/ })).not.toBeInTheDocument();
    });
  });

  describe("given a viewer who can open the owner project", () => {
    it("offers the link to it", () => {
      renderWithDesignSystem(
        <BraidedSpanCallout braid={braid({ canOpenOwner: true })} ownerHref="/specialists" />,
      );

      expect(screen.getByRole("link", { name: "Open in Specialists" })).toHaveAttribute(
        "href",
        "/specialists",
      );
    });
  });
});
