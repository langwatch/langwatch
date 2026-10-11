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

  /** @scenario A narrow described header wraps its actions below instead of overlapping the title */
  it("keeps the title clear of the actions at 390px and leaves desktop geometry alone", async () => {
    const actions = (
      <>
        <PageLayout.HeaderButton>Audit history</PageLayout.HeaderButton>
        <PageLayout.HeaderButton>View traces</PageLayout.HeaderButton>
        <PageLayout.HeaderButton>Disable</PageLayout.HeaderButton>
        <PageLayout.HeaderButton>Revoke</PageLayout.HeaderButton>
      </>
    );
    renderWithDesignSystem(
      <>
        <div style={{ width: 390 }}>
          <PageLayout.Header
            data-testid="narrow"
            description="Used by the support tools and the gateway."
            actions={actions}
          >
            <PageLayout.Heading>
              Production support key for the payments gateway in Frankfurt
            </PageLayout.Heading>
          </PageLayout.Header>
        </div>
        <div style={{ width: 1280 }}>
          <PageLayout.Header
            data-testid="wide"
            description="Used by the support tools and the gateway."
            actions={actions}
          >
            <PageLayout.Heading>Production support key</PageLayout.Heading>
          </PageLayout.Header>
        </div>
      </>,
    );

    await waitFor(() => {
      const narrow = screen.getByTestId("narrow");
      const title = narrow.querySelector("h1");
      const buttons = narrow.querySelector("[data-header-actions]");
      const line = narrow.querySelector("[data-header-description]");
      if (!title || !buttons || !line) throw new Error("narrow header missing its parts");
      const header = narrow.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const a = buttons.getBoundingClientRect();
      expect(a.top).toBeGreaterThanOrEqual(line.getBoundingClientRect().bottom);
      expect(t.right).toBeLessThanOrEqual(header.right);
      expect(a.right).toBeLessThanOrEqual(header.right);
      expect(t.height).toBe(28);
      expect(getComputedStyle(title).textOverflow).toBe("ellipsis");
      expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
      expect(t.bottom <= a.top || t.right <= a.left).toBe(true);

      const wide = screen.getByTestId("wide");
      const wideTitle = wide.querySelector("h1");
      const wideButtons = wide.querySelector("[data-header-actions]");
      if (!wideTitle || !wideButtons) throw new Error("wide header missing its parts");
      expect(wideButtons.getBoundingClientRect().top).toBeLessThan(
        wide.getBoundingClientRect().top + 48,
      );
      expect(wideTitle.getBoundingClientRect().right).toBeLessThanOrEqual(
        wideButtons.getBoundingClientRect().left,
      );
      expect(height({ element: wide })).toBe(77);
    });
  });
});
