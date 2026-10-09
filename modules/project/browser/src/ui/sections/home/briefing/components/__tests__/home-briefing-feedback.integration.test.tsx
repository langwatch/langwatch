/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefingData } from "../../types.ts";

const langy = {
  openPanel: vi.fn(),
  askLangy: vi.fn(),
  attachContext: vi.fn(),
  setDraft: vi.fn(),
};
vi.mock("../../../../../../behavior/langy/langy.store.ts", () => ({
  useLangyStore: (selector: (s: typeof langy) => unknown) => selector(langy),
}));

const data: BriefingData = {
  since: "last 30 days",
  headline: "1 signal needs attention.",
  receiptsLabel: "Attention inbox",
  receipts: [
    {
      id: "error-shape:rate-limit",
      severity: "error",
      subject: "New error shape",
      detail: "429s from the gateway",
    },
  ],
  suggestions: [],
};
vi.mock("../../hooks/use-langy-briefing.ts", () => ({
  useLangyBriefing: () => ({
    data,
    statusCells: [],
    isLoading: false,
    isAnalyticsLoading: false,
    isRefreshing: false,
  }),
}));
vi.mock("../home-overview-card.tsx", () => ({ HomeOverviewCard: () => null }));

import {
  ProjectHomeHostProvider,
  ProjectHomeHost,
  type ProjectHomeProject,
} from "../../../../../../model/project-home-host.ts";
import { HomeBriefingSection } from "../home-briefing-section.tsx";

/** A reader who may read Langy but not start a conversation (`langy:view` only). */
class ViewOnlyHost extends ProjectHomeHost {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "Acme", slug: "acme" };
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
    return { show: true, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return true;
  }
  navigate(): void {}
}

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(langy)) fn.mockClear();
});

describe("given the home briefing with an attention inbox", () => {
  /** @scenario "Feedback on the briefing opens Langy with a draft, not a question" */
  it("opens Langy with the feedback sentence as an unsent draft", () => {
    renderWithDesignSystem(
      <ProjectHomeHostProvider value={new ViewOnlyHost()}>
        <HomeBriefingSection />
      </ProjectHomeHostProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Missing a signal? Tell us" }));

    expect(langy.setDraft).toHaveBeenCalledWith(
      "Feedback on the anomalies feed: the signal I'm missing is ",
    );
    expect(langy.openPanel).toHaveBeenCalled();
    expect(langy.askLangy).not.toHaveBeenCalled();
  });
});
