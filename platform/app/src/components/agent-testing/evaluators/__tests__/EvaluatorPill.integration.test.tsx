/**
 * @vitest-environment jsdom
 *
 * One attached evaluator as a pill: whether it renders as a control or as
 * static content, depending on whether it has anything to click.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluatorPill } from "../EvaluatorPill";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<EvaluatorPill />", () => {
  afterEach(cleanup);

  describe("given no onClick", () => {
    /** @scenario "A static pill is not exposed as a button" */
    it("renders as static content rather than a button", () => {
      render(
        <EvaluatorPill
          attachmentId="attachment_1"
          name="Exactness"
          required={false}
          missingInputs={[]}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByRole("button", { name: "Exactness" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Exactness")).toBeInTheDocument();
    });
  });

  describe("given an onClick", () => {
    describe("when the pill is clicked", () => {
      /** @scenario "An interactive pill stays a button" */
      it("renders as a button and calls onClick", async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(
          <EvaluatorPill
            attachmentId="attachment_1"
            name="Exactness"
            required={false}
            missingInputs={[]}
            onClick={onClick}
          />,
          { wrapper: Wrapper },
        );

        const button = screen.getByRole("button", { name: "Exactness" });
        await user.click(button);
        expect(onClick).toHaveBeenCalled();
      });
    });
  });
});
