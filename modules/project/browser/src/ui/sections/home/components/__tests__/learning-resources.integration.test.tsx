/**
 * @vitest-environment jsdom
 * The home footer's links and where each one lands.
 * Spec: specs/home/learning-resources.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../../../model/project-home-host.ts";
import { LearningResources } from "../learning-resources.tsx";

const FOOTER_LINKS = [
  ["Python SDK", "https://docs.langwatch.ai/integration/python/guide"],
  ["TypeScript SDK", "https://docs.langwatch.ai/integration/typescript/guide"],
  ["Go SDK", "https://docs.langwatch.ai/integration/go/guide"],
  ["Scenario", "https://scenario.langwatch.ai"],
  ["REST API", "https://docs.langwatch.ai/integration/rest-api"],
  ["GitHub", "https://github.com/langwatch/langwatch"],
  ["Status", "https://status.langwatch.ai"],
  ["Terms", "https://langwatch.ai/legal/terms-conditions"],
  ["Privacy Policy", "https://langwatch.ai/legal/privacy-policy"],
] as const;

class StubProjectHomeHost extends ProjectHomeHost {
  readonly visited: string[] = [];
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "Acme App", slug: "acme-app" };
  }
  organization(): ProjectHomeOrganization | undefined {
    return { id: "org-1", name: "Acme" };
  }
  currentUser(): ProjectHomeUser | undefined {
    return { id: "user-1", name: "Ada" };
  }
  isLoading(): boolean {
    return false;
  }
  hasPermission(): boolean {
    return false;
  }
  langyVisibility(): ProjectHomeLangyVisibility {
    return { show: false, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment(): ProjectHomeDeployment {
    return { isSaaS: false, isDevelopment: true };
  }
  reducedMotion(): boolean {
    return true;
  }
  navigate(to: string): void {
    this.visited.push(to);
  }
}

function renderFooter() {
  const host = new StubProjectHomeHost();
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={host}>
        <LearningResources />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );
  return { host, footer: view.container };
}

afterEach(cleanup);

describe("<LearningResources />", () => {
  describe("when the footer renders", () => {
    /** @scenario Every footer link points at its destination */
    it("lists every link, in order, at its address", () => {
      renderFooter();

      const links = screen.getAllByRole("link");
      expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
        FOOTER_LINKS.map(([label, href]) => [label, href]),
      );
    });

    /** @scenario Footer links open outside the product */
    it("opens each link in a new tab that cannot reach back", () => {
      const { host } = renderFooter();

      for (const link of screen.getAllByRole("link")) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        link.click();
      }
      expect(host.visited).toEqual([]);
    });

    /** @scenario The footer carries no development controls */
    it("holds only the copyright line and its links, even on a development build", () => {
      const { footer } = renderFooter();

      expect(within(footer).queryByRole("combobox")).toBeNull();
      expect(within(footer).getByText(/^LangWatch © \d{4}$/)).toBeDefined();
    });
  });
});
