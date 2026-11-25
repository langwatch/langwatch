// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type HeaderButtonProps, PageLayout } from "../src/components/layout/page-layout.tsx";
import { Menu } from "../src/components/overlays/menu.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("page header actions", () => {
  /** @scenario A header button that links keeps the link */
  it("renders a link element with its href, target and rel as the button", () => {
    renderWithDesignSystem(
      <PageLayout.Header
        actions={
          <PageLayout.HeaderButton asChild primary>
            <a href="https://langwatch.ai/pricing" target="_blank" rel="noreferrer">
              Talk to sales
            </a>
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Licence</PageLayout.Heading>
      </PageLayout.Header>,
    );
    const link = screen.getByRole("link", { name: "Talk to sales" });
    expect(link).toHaveAttribute("href", "https://langwatch.ai/pricing");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link.className).toContain("chakra-button");
  });

  /** @scenario A header button opens a menu and reports it */
  it("composes with Menu.Trigger and keeps the popup attributes", async () => {
    renderWithDesignSystem(
      <Menu.Root>
        <Menu.Trigger asChild>
          <PageLayout.HeaderButton primary>New</PageLayout.HeaderButton>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="dataset">Dataset</Menu.Item>
        </Menu.Content>
      </Menu.Root>,
    );
    const button = screen.getByRole("button", { name: "New" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.getAttribute("aria-controls")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dataset" })).toBeInTheDocument();
  });

  /** @scenario A header button submits a form elsewhere on the page */
  it("submits the form it names", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    renderWithDesignSystem(
      <>
        <form id="settings" onSubmit={onSubmit}>
          <input aria-label="Name" />
        </form>
        <PageLayout.Header
          actions={
            <PageLayout.HeaderButton type="submit" form="settings" primary>
              Save
            </PageLayout.HeaderButton>
          }
        >
          <PageLayout.Heading>Settings</PageLayout.Heading>
        </PageLayout.Header>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /** @scenario The closed header props reject style props */
  it("types style props as errors on the closed shape and keeps them as deprecated", () => {
    const closed = (
      <PageLayout.Header actions={<PageLayout.HeaderButton>Export</PageLayout.HeaderButton>}>
        <PageLayout.Heading>Datasets</PageLayout.Heading>
        <PageLayout.Subtitle>Every dataset</PageLayout.Subtitle>
      </PageLayout.Header>
    );
    // @ts-expect-error the closed button takes no style props
    const unsupported: HeaderButtonProps = { marginTop: 2, children: "Export" };
    expect(closed).toBeTruthy();
    expect(unsupported).toBeTruthy();
    renderWithDesignSystem(
      <PageLayout.Header withBorder={false}>
        <PageLayout.Heading truncate>Legacy</PageLayout.Heading>
        <PageLayout.HeaderButton marginTop={2}>Old</PageLayout.HeaderButton>
      </PageLayout.Header>,
    );
    expect(screen.getByRole("button", { name: "Old" })).toBeInTheDocument();
  });
});
