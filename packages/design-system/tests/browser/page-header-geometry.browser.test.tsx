/**
 * Measured page header geometry in real Chromium: the title-only row and the described header.
 * @see packages/design-system/specs/page-header-scroll.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

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
  /** @scenario Header tabs can stack under the heading on phones */
  it("stacks opted-in tabs as a 36px row at 320px and leaves callers that omit the prop alone", async () => {
    const tabs = [
      { label: "Scenarios", href: "/a", count: 128 },
      { label: "Results", href: "/b", count: 4096 },
    ];
    const header = (testId: string, stackOnMobile?: boolean) => (
      <PageLayout.Header>
        <PageLayout.Heading>Long run plan name for the checkout agent</PageLayout.Heading>
        <PageLayout.Tabs
          label={testId}
          tabs={tabs}
          activeHref="/a"
          onNavigate={() => {}}
          stackOnMobile={stackOnMobile}
        />
      </PageLayout.Header>
    );
    await page.viewport(320, 700);
    renderWithDesignSystem(
      <>
        <div style={{ width: 320 }}>{header("stacked", true)}</div>
        <div style={{ width: 320 }}>{header("plain")}</div>
      </>,
    );

    await waitFor(() => {
      const nav = (name: string) => {
        const element = screen.getByRole("navigation", { name });
        return { element, rect: element.getBoundingClientRect(), style: getComputedStyle(element) };
      };
      const stacked = nav("stacked");
      const title = stacked.element.parentElement?.querySelector("h1");
      if (!title) throw new Error("stacked header missing its title");
      expect(stacked.rect.height).toBe(36);
      expect(stacked.style.marginInlineStart).toBe("0px");
      expect(stacked.rect.top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom);
      expect(stacked.style.overflowX).toBe("auto");
      const header = stacked.element.parentElement;
      if (!header) throw new Error("stacked header missing");
      expect(header.getBoundingClientRect().right).toBeLessThanOrEqual(320);
      expect(stacked.rect.right).toBeLessThanOrEqual(320);

      const plain = nav("plain");
      expect(plain.style.marginInlineStart).toBe("12px");
      expect(plain.style.overflowX).toBe("visible");
    });
  });

  /** @scenario Header tabs can stack under the heading on phones */
  it("keeps opted-in tabs inline with their 12px start margin at 1280px", async () => {
    await page.viewport(1280, 800);
    renderWithDesignSystem(
      <PageLayout.Header>
        <PageLayout.Heading>Run plan</PageLayout.Heading>
        <PageLayout.Tabs
          stackOnMobile
          label="wide"
          tabs={[{ label: "Scenarios", href: "/a" }]}
          activeHref="/a"
          onNavigate={() => {}}
        />
      </PageLayout.Header>,
    );

    await waitFor(() => {
      const nav = screen.getByRole("navigation", { name: "wide" });
      const title = nav.parentElement?.querySelector("h1");
      if (!title) throw new Error("wide header missing its title");
      expect(getComputedStyle(nav).marginInlineStart).toBe("12px");
      expect(getComputedStyle(nav).overflowX).toBe("visible");
      expect(nav.getBoundingClientRect().top).toBeLessThan(title.getBoundingClientRect().bottom);
    });
  });

  /** @scenario Header actions wrap under the title instead of leaving the screen */
  it("keeps actions in view: one row at 1280px, wrapped and grown at 900px, start-aligned at 390px", async () => {
    const actions = (
      <>
        <PageLayout.HeaderButton>Rotate</PageLayout.HeaderButton>
        <PageLayout.HeaderButton>Disable</PageLayout.HeaderButton>
        <PageLayout.HeaderButton>Revoke</PageLayout.HeaderButton>
      </>
    );
    const longTitle = "Production support key for the payments gateway in Frankfurt and Dublin";
    const parts = (testId: string) => {
      const header = screen.getByTestId(testId);
      const title = header.querySelector("h1");
      const buttons = header.querySelector("[data-header-actions]");
      if (!title || !buttons) throw new Error("header missing its parts");
      return { header, title, buttons };
    };
    const render = (width: number, title: string) => {
      renderWithDesignSystem(
        <div style={{ width }}>
          <PageLayout.Header data-testid="h" actions={actions}>
            <PageLayout.Heading>{title}</PageLayout.Heading>
          </PageLayout.Header>
        </div>,
      );
    };

    await page.viewport(1280, 800);
    render(1280, "Key");
    await waitFor(() => {
      const { header, title, buttons } = parts("h");
      expect(height({ element: header })).toBe(48);
      expect(buttons.getBoundingClientRect().left).toBeGreaterThan(
        title.getBoundingClientRect().right,
      );
      expect(buttons.getBoundingClientRect().top).toBeLessThan(
        header.getBoundingClientRect().bottom - 36,
      );
    });
    cleanup();

    await page.viewport(900, 800);
    render(500, longTitle);
    await waitFor(() => {
      const { header, title, buttons } = parts("h");
      const box = header.getBoundingClientRect();
      const row = buttons.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(48);
      expect(row.top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom);
      expect(row.right).toBeLessThanOrEqual(Math.min(box.right, window.innerWidth));
      expect(row.right).toBeGreaterThan(box.right - 40);
      for (const button of buttons.querySelectorAll("button")) {
        const rect = button.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
      }
    });
    cleanup();

    await page.viewport(390, 800);
    render(390, longTitle);
    await waitFor(() => {
      const { header, buttons } = parts("h");
      const box = header.getBoundingClientRect();
      expect(buttons.getBoundingClientRect().left).toBeLessThan(box.left + 40);
      expect(buttons.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
      expect(box.height).toBeGreaterThan(48);
    });
  });
});
