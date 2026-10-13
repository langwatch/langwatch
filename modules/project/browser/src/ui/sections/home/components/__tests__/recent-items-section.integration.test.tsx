/**
 * @vitest-environment jsdom
 * A failed recent-items read says so and offers a retry that reads again.
 * See specs/home/recent-items-ui.feature.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refetch = vi.fn();
vi.mock("../../../../../behavior/use-recent-items.ts", () => ({
  useRecentItems: () => ({
    data: undefined,
    isLoading: false,
    error: new Error("recent items unavailable"),
    refetch,
  }),
}));

import {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host.ts";
import { RecentItemsSection } from "../recent-items-section.tsx";

class StubProjectHomeHost extends ProjectHomeHost {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "My Project", slug: "my-project" };
  }
  organization() {
    return undefined;
  }
  currentUser() {
    return undefined;
  }
  isLoading(): boolean {
    return false;
  }
  hasPermission(): boolean {
    return true;
  }
  langyVisibility() {
    return { show: false, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return false;
  }
  navigate(): void {}
}

function renderSection(ui: React.ReactElement) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>{ui}</ProjectHomeHostProvider>
    </DesignSystemProvider>,
  );
}

describe("<RecentItemsSection /> when the read fails", () => {
  afterEach(() => {
    cleanup();
    refetch.mockClear();
  });

  /** @scenario "Handles API error gracefully" */
  it("keeps the section and says the recent items failed to load", () => {
    renderSection(<RecentItemsSection />);

    expect(screen.getByText("Jump right back")).toBeTruthy();
    expect(screen.getByText("Failed to load recent items")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  /** @scenario "Retry button refetches data" */
  it("reads again when Retry is pressed", () => {
    renderSection(<RecentItemsSection />);

    fireEvent.click(screen.getByText("Retry"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
