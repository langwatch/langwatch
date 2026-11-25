/**
 * The tips an inline organisation alert lists under a failure: only the ones a person can act on.
 * Spec: specs/features/handled-error-presentation.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HandledErrorAlert } from "../handled-error-form.tsx";

const META_TIP = "Use one of the fields listed in meta.knownFields; meta.hint names the likely one";
const PEOPLE_TIP = "Check the spelling of the field and try again";

afterEach(() => cleanup());

describe("given a failure whose tips include one written for an API caller", () => {
  describe("when the inline alert renders it", () => {
    /** @scenario "A tip written for an API caller is not shown to a person" */
    it("leaves out the tip that points at a meta field and keeps the rest", () => {
      renderWithDesignSystem(
        <HandledErrorAlert
          error={{
            data: {
              error: {
                code: "unknown_field",
                httpStatus: 422,
                meta: {},
                tips: [META_TIP, PEOPLE_TIP],
              },
            },
          }}
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert.textContent).not.toContain("meta.");
      expect(alert.textContent).toContain(PEOPLE_TIP);
    });
  });
});
