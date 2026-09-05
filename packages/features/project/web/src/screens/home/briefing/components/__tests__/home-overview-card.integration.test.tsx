/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host";
import type { StatusCell } from "../../types";
import { HomeOverviewCard } from "../home-overview-card";

class StubProjectHomeHost extends ProjectHomeHostPort {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "My Project", slug: "acme" };
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
  featureFlag() {
    return { enabled: false, isLoading: false };
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
    return true;
  }
  navigate(): void {}
}

const cells: StatusCell[] = [
  { label: "Pass rate", value: "92%", tone: "good" },
  { label: "Traces · threads", value: "128 · 40", tone: "vanity" },
];

function renderCard(props: Partial<Parameters<typeof HomeOverviewCard>[0]>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
        <HomeOverviewCard cells={cells} {...props} />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

describe("HomeOverviewCard", () => {
  describe("when a background refetch is in flight", () => {
    /** @scenario Refetching does not wipe the overview card */
    it("keeps the previous cells on screen with only a subtle refreshing hint", () => {
      renderCard({ refreshing: true });

      expect(screen.getByText("92%")).toBeDefined();
      expect(screen.getByText("128 · 40")).toBeDefined();
      // The skeleton placeholders only ever render for an empty, still-loading
      // card — never as a swap over cells already on screen.
      expect(screen.queryAllByText("Pass rate")).toHaveLength(1);
    });

    it("does not render the empty-state skeleton grid while cells are on screen", () => {
      const { container } = renderCard({ refreshing: true });

      // The skeleton grid renders exactly six placeholder pairs when
      // `cells.length === 0 && isLoading`; with real cells present, none do.
      expect(container.querySelectorAll('[class*="chakra-skeleton"]')).toHaveLength(0);
    });
  });

  describe("when first loading, with nothing to show yet", () => {
    it("renders the skeleton grid instead of an empty card", () => {
      const { container } = renderCard({ cells: [], isLoading: true });

      expect(container.querySelectorAll('[class*="chakra-skeleton"]').length).toBeGreaterThan(0);
    });
  });
});
