/**
 * @vitest-environment jsdom
 * No local rail: the product sidebar carries these pages now.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import AiGatewayLayout from "../gateway-layout.tsx";

afterEach(cleanup);

describe("given a gateway page", () => {
  /** @scenario The rail stands down when the product sidebar carries the pages */
  it("renders no local navigation rail and gives the content the full width", () => {
    renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, {
      host: fakeGatewayHost(),
    });

    expect(screen.queryByTestId("section-navigation-links")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    const content = screen.getByTestId("section-navigation-layout");
    expect(content.textContent).toBe("page content");
  });

  it("writes the page title it is given as the document title", async () => {
    renderWithGatewayHost(
      <AiGatewayLayout pageTitle="A page · LangWatch">page content</AiGatewayLayout>,
      {
        host: fakeGatewayHost(),
      },
    );

    await waitFor(() => expect(document.title).toBe("A page · LangWatch"));
  });
});
