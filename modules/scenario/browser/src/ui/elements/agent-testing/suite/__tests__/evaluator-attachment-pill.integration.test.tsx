/**
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorAttachmentPill } from "../suite-evaluators-section.tsx";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

describe("<EvaluatorAttachmentPill />", () => {
  describe("given a pill with nothing to click", () => {
    /** @scenario "A static pill is not exposed as a button" */
    it("is read as its name, not as a button", () => {
      render(
        <EvaluatorAttachmentPill
          attachmentId="a1"
          name="Exactness"
          required={false}
          missingInputs={[]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByLabelText("Exactness")).toHaveTextContent("Exactness");
    });
  });

  describe("given a pill that opens the evaluator editor", () => {
    /** @scenario "An interactive pill stays a button" */
    it("is a button and carries out the choice", async () => {
      const onClick = vi.fn();
      render(
        <EvaluatorAttachmentPill
          attachmentId="a1"
          name="Exactness"
          required={false}
          missingInputs={[]}
          onClick={onClick}
        />,
        { wrapper: Wrapper },
      );

      await userEvent.setup().click(screen.getByRole("button", { name: "Exactness" }));

      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});
