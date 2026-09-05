/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askLangy = vi.fn();
vi.mock("@langwatch/langy-web", () => ({
  useLangyStore: (selector: (s: { askLangy: typeof askLangy }) => unknown) =>
    selector({ askLangy }),
}));

import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host";
import { QuietHeadline } from "../quiet-headline";

const navigate = vi.fn();

class StubProjectHomeHost extends ProjectHomeHostPort {
  constructor(private readonly canAsk: boolean) {
    super();
  }
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
  featureFlag() {
    return { enabled: false, isLoading: false };
  }
  langyVisibility() {
    return { show: this.canAsk, isResolving: false };
  }
  canAskLangy(): boolean {
    return this.canAsk;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return true;
  }
  navigate(href: string): void {
    navigate(href);
  }
}

const renderHeadline = (canAsk = false) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost(canAsk)}>
        <QuietHeadline />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );

afterEach(cleanup);

beforeEach(() => {
  askLangy.mockClear();
  navigate.mockClear();
});

describe("QuietHeadline invitation", () => {
  describe("given a brand-new quiet project", () => {
    describe("when the prominent action is clicked", () => {
      /** @scenario The quiet invitation leads with sending the first trace */
      it("lands on the trace surface", () => {
        renderHeadline();

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }));

        expect(navigate).toHaveBeenCalledWith("/acme/traces");
      });

      it("leaves modified clicks to the browser for open-in-a-tab", () => {
        renderHeadline();

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }), {
          metaKey: true,
        });

        expect(navigate).not.toHaveBeenCalled();
      });
    });

    describe("when the rotation renders under reduced motion", () => {
      it("offers the OTHER first steps, not sending a trace again", () => {
        renderHeadline();

        expect(
          screen.getByRole("button", { name: "Learn more: Generate a dataset" }),
        ).toBeDefined();
        expect(screen.queryByRole("button", { name: /Send a trace/ })).toBeNull();
      });
    });
  });

  describe("given the reader does not have Langy", () => {
    /** @scenario The quiet invitation adapts to Langy's absence */
    it("offers no Langy hand-off anywhere", () => {
      renderHeadline(false);

      expect(screen.queryByText("Walk me through it")).toBeNull();
      expect(screen.queryByText("Do it with Langy")).toBeNull();
    });

    describe("when the prominent action is clicked", () => {
      it("still opens the trace surface", () => {
        renderHeadline(false);

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }));

        expect(navigate).toHaveBeenCalledWith("/acme/traces");
        expect(askLangy).not.toHaveBeenCalled();
      });
    });

    describe("when the typed step is clicked", () => {
      it("opens the feature surface that teaches it", () => {
        renderHeadline(false);

        fireEvent.click(screen.getByRole("button", { name: "Learn more: Generate a dataset" }));

        expect(navigate).toHaveBeenCalledWith("/acme/datasets");
        expect(askLangy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the reader has Langy", () => {
    describe("when the walkthrough is chosen", () => {
      it("hands the trace step to Langy", () => {
        renderHeadline(true);

        fireEvent.click(
          screen.getByRole("button", { name: "Ask Langy how to send your first trace" }),
        );

        expect(askLangy).toHaveBeenCalledWith(expect.stringContaining("first trace"));
        expect(navigate).not.toHaveBeenCalled();
      });
    });

    describe("when the rotating step is handed to Langy", () => {
      it("sends its question already composed", () => {
        renderHeadline(true);

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy: Generate a dataset" }));

        expect(askLangy).toHaveBeenCalledWith(expect.stringContaining("dataset"));
        expect(screen.getByText("Do it with Langy")).toBeDefined();
      });
    });
  });
});
