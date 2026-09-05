/**
 * @vitest-environment jsdom
 * No local rail: the product sidebar carries these pages now.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import AiGatewayLayout from "../gateway-layout";

afterEach(cleanup);

describe("given a gateway page", () => {
  /** @scenario The rail stands down when the product sidebar carries the pages */
  it("renders no local navigation rail and gives the content the full width", () => {
    renderWithGatewayHost(<AiGatewayLayout>page content</AiGatewayLayout>, {
      host: fakeGatewayHost(),
    });

    expect(screen.queryByTestId("section-navigation-links")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    const content = screen.getByTestId("section-navigation-content");
    expect(content.textContent).toBe("page content");
  });
});
