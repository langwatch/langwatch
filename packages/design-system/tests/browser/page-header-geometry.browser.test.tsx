/**
 * Measured page header geometry in real Chromium: the title-only row and the described header.
 * @see packages/design-system/specs/page-header-scroll.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLayout } from "../../src/components/layout/page-layout.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

const height = ({ element }: { element: Element }) => element.getBoundingClientRect().height;

describe("page header geometry", () => {
  /** @scenario A described header grows to its description and spaces it by the scale */
  it("measures 77px for one description line, 4px under the title, and 48px without one", async () => {
    renderWithDesignSystem(
      <div style={{ width: 640 }}>
        <PageLayout.Header data-testid="described" description="What a role can do.">
          <PageLayout.Heading>Roles</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Header data-testid="plain">
          <PageLayout.Heading>Security</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Header
          data-testid="wrapped"
          description="A long description that wraps onto further lines because the header is narrower than the sentence it has to carry, however it is set."
        >
          <PageLayout.Heading>Directory</PageLayout.Heading>
        </PageLayout.Header>
      </div>,
    );

    await waitFor(() => {
      const described = screen.getByTestId("described");
      const title = described.querySelector("h1");
      const line = described.querySelector("[data-header-description]");
      if (!title || !line) throw new Error("described header missing its parts");
      const header = described.getBoundingClientRect();
      expect(header.height).toBe(77);
      expect(title.getBoundingClientRect().top - header.top).toBe(12);
      expect(line.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toBe(4);
      expect(height({ element: line })).toBe(20);
      expect(height({ element: screen.getByTestId("plain") })).toBe(48);
      const wrapped = screen.getByTestId("wrapped").querySelector("[data-header-description]");
      if (!wrapped) throw new Error("wrapped header missing its description");
      expect(height({ element: wrapped }) % 20).toBe(0);
      expect(height({ element: wrapped })).toBeGreaterThan(20);
      expect(height({ element: screen.getByTestId("wrapped") })).toBe(
        57 + height({ element: wrapped }),
      );
    });
  });
});
