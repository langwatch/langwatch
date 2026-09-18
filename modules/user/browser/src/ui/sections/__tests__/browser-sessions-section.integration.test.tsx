/**
 * @vitest-environment jsdom
 *
 * Browser sessions band: structural only, no scenario bound (see handoff).
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { BrowserSessionsSection } from "../browser-sessions-section.tsx";

afterEach(() => cleanup());

describe("given the browser sessions band on the profile page", () => {
  describe("when it renders", () => {
    it("shows the band without claiming a session it cannot read", () => {
      const host = fakePersonalWorkspaceHost();
      renderWithPersonalWorkspaceHost(<BrowserSessionsSection />, { host });

      expect(screen.getByTestId("browser-sessions-section")).toBeTruthy();
    });
  });
});
