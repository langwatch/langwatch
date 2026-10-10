/**
 * @vitest-environment jsdom
 * No local rail: the product sidebar carries these pages now.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";
import GovernanceLayout from "../governance-layout.tsx";

afterEach(cleanup);

describe("given a governance page", () => {
  /** @scenario The rail stands down when the product sidebar carries the pages */
  it("renders no local navigation rail and gives the content the full width", () => {
    renderWithGovernanceHost(<GovernanceLayout>page content</GovernanceLayout>, {
      host: fakeGovernanceHost({ enabledFlags: [] }),
    });

    expect(screen.queryByTestId("section-navigation-links")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    const content = screen.getByTestId("section-navigation-layout");
    expect(content.textContent).toBe("page content");
  });

  it("writes the page title it is given as the document title", async () => {
    renderWithGovernanceHost(
      <GovernanceLayout pageTitle="A page · LangWatch">page content</GovernanceLayout>,
      {
        host: fakeGovernanceHost({ enabledFlags: [] }),
      },
    );

    await waitFor(() => expect(document.title).toBe("A page · LangWatch"));
  });
});
