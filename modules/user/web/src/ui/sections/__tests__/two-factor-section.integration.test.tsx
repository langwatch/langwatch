/**
 * @vitest-environment jsdom
 *
 * Two-step verification band: honest about carrying no backend yet.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { TwoFactorSection } from "../two-factor-section.tsx";

afterEach(() => cleanup());

describe("given no two-step verification backend on this deployment", () => {
  describe("when the section renders", () => {
    it("names the subject and says it is not available, rather than offering a dead control", () => {
      renderWithPersonalWorkspaceHost(<TwoFactorSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      const section = screen.getByTestId("two-factor-section");
      expect(section).toBeTruthy();
      expect(screen.getByText(/not available on this deployment yet/i)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
