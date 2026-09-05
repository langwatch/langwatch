/**
 * @vitest-environment jsdom
 * No local rail: the product sidebar carries these pages now.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing";
import GovernanceLayout from "../governance-layout";

afterEach(cleanup);

describe("given a governance page", () => {
  /** @scenario The rail stands down when the product sidebar carries the pages */
  it("renders no local navigation rail and gives the content the full width", () => {
    renderWithGovernanceHost(<GovernanceLayout>page content</GovernanceLayout>, {
      host: fakeGovernanceHost({ enabledFlags: [] }),
    });

    expect(screen.queryByTestId("section-navigation-links")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    const content = screen.getByTestId("section-navigation-content");
    expect(content.textContent).toBe("page content");
  });
});
