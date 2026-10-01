/**
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorAttachmentPill } from "../suite-evaluators-section.tsx";

afterEach(cleanup);

describe("<EvaluatorAttachmentPill />", () => {
  describe("given a pill with nothing to click", () => {
    /** @scenario "A static pill is not exposed as a button" */
    it("is read as its name, not as a button", () => {
      renderWithDesignSystem(
        <EvaluatorAttachmentPill
          attachmentId="a1"
          name="Exactness"
          required={false}
          missingInputs={[]}
        />,
      );

      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByLabelText("Exactness")).toHaveTextContent("Exactness");
    });
  });

  describe("given a pill that opens the evaluator editor", () => {
    /** @scenario "An interactive pill stays a button" */
    it("is a button and carries out the choice", async () => {
      const onClick = vi.fn();
      renderWithDesignSystem(
        <EvaluatorAttachmentPill
          attachmentId="a1"
          name="Exactness"
          required={false}
          missingInputs={[]}
          onClick={onClick}
        />,
      );

      await userEvent.setup().click(screen.getByRole("button", { name: "Exactness" }));

      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});
