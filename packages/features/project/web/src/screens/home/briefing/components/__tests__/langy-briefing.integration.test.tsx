/**
 * @vitest-environment jsdom
 *
 * Ported from platform/app/src/features/briefing/components/LangyBriefing.unit.test.tsx
 * (origin/main); `LangyBriefing`'s own props are unchanged by the move.
 * See specs/home/signal-focused-home-rollout.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host";
import type { BriefingData, BriefingReceipt } from "../../types";
import { LangyBriefing } from "../langy-briefing";

/** Only `navigate` is exercised — internal Trace Explorer links route through it. */
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
    return { show: true, isResolving: false };
  }
  canAskLangy(): boolean {
    return true;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return false;
  }
  navigate(): void {}
}

const receipt: BriefingReceipt = {
  id: "error-shape:rate-limit",
  severity: "error",
  subject: "New error shape",
  detail: "“Provider rate limit” on 4 traces.",
  link: {
    label: "Open traces",
    href: "/acme/traces#all-traces?q=errorMessage%3A%22Provider+rate+limit%22&preset=30d",
  },
  context: {
    id: 'errorMessage:"Provider rate limit"',
    label: "New error shape: Provider rate limit",
    query: 'errorMessage:"Provider rate limit"',
  },
  askPrompt: "Investigate this new error shape and separate evidence from hypotheses.",
};

const data: BriefingData = {
  since: "last 30 days",
  headline: "1 signal needs attention.",
  receiptsLabel: "Attention inbox",
  receipts: [receipt],
  suggestions: ["Why did errors spike?"],
};

function renderBriefing(props: {
  onInvestigateReceipt?: (item: BriefingReceipt) => void;
  onAsk?: () => void;
  onAskSubmit?: (question: string) => void;
  onFeedback?: () => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
        <LangyBriefing data={data} {...props} />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

describe("LangyBriefing attention inbox actions", () => {
  it("hands the complete receipt to the investigate action", () => {
    const onInvestigateReceipt = vi.fn();
    renderBriefing({ onInvestigateReceipt });

    fireEvent.click(screen.getByRole("button", { name: "Investigate New error shape in Langy" }));

    expect(onInvestigateReceipt).toHaveBeenCalledWith(receipt);
  });

  it("makes the whole row a link to the Trace Explorer evidence", () => {
    renderBriefing({});

    expect(
      screen.getByRole("link", { name: "Open traces for New error shape" }).getAttribute("href"),
    ).toBe(receipt.link?.href);
  });

  it("does not render a separate per-row Ask Langy button", () => {
    renderBriefing({ onInvestigateReceipt: vi.fn() });

    expect(screen.queryByRole("button", { name: /Ask Langy about/ })).toBeNull();
  });
});

describe("LangyBriefing without Langy", () => {
  describe("when no Langy handlers are provided", () => {
    /** @scenario Without Langy the sheet keeps working, quietly */
    it("keeps the row's Trace Explorer evidence link working", () => {
      renderBriefing({});

      expect(
        screen.getByRole("link", { name: "Open traces for New error shape" }).getAttribute("href"),
      ).toBe(receipt.link?.href);
    });

    it("offers no control that hands a signal to Langy", () => {
      renderBriefing({});

      expect(screen.queryByRole("button", { name: /in Langy/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Investigate/ })).toBeNull();
      expect(screen.queryByText("⌘I")).toBeNull();
      expect(screen.queryByRole("button", { name: "Why did errors spike?" })).toBeNull();
      expect(screen.queryByText("Missing a signal? Tell us")).toBeNull();
    });
  });

  describe("when Langy handlers are provided", () => {
    /** @scenario With Langy the sheet keeps its hand-offs */
    it("renders the ask row and sends the clicked suggestion chip", () => {
      const onAskSubmit = vi.fn();
      renderBriefing({ onAsk: vi.fn(), onAskSubmit });

      expect(screen.getByText("⌘I")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Why did errors spike?" }));

      expect(onAskSubmit).toHaveBeenCalledWith("Why did errors spike?");
    });
  });
});
