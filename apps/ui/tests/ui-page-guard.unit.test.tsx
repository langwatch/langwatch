/**
 * @vitest-environment jsdom
 *
 * The policy in front of a routed page, and the order it is applied in.
 *
 * Both halves are here: the decision on its own, because the ordering is the
 * whole point and a decision is cheaper to pin than three mounted components,
 * and the rendering, because a guard that decides correctly and renders the
 * wrong fallback is the same bug to a reader.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiFailureNotice,
  UiFeedbackPort,
  type UiSuccessNotice,
} from "../src/behavior/ui-capabilities";
import { resolveUiPageAccess, withUiPageGuard } from "../src/ui/sections/ui-page-guard";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(_: UiSuccessNotice): void {}
  failed(_: UiFailureNotice): void {}
}

class AnsweringSession extends UiSessionPort {
  constructor(
    private readonly answers: {
      flags: Record<string, boolean | undefined>;
      permissions: readonly string[];
      settled: boolean;
    },
  ) {
    super();
  }

  currentUser(): UiActor | null {
    return null;
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: null };
  }

  hasPermission(permission: string): boolean {
    return this.answers.permissions.includes(permission);
  }

  isSettled(): boolean {
    return this.answers.settled;
  }

  featureFlag(flag: string): boolean | undefined {
    return this.answers.flags[flag];
  }
}

function capabilities(session: UiSessionPort): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session,
  };
}

const Page = () => <div>the page</div>;

function renderGuarded(session: UiSessionPort) {
  const Guarded = withUiPageGuard({
    flags: ["release_ui_ai_governance_enabled"],
    permission: "governance:view",
    fallbacks: {
      loading: () => <div>still asking</div>,
      notFound: () => <div>not here</div>,
      forbidden: ({ permission }) => <div>missing {permission}</div>,
    },
  })(Page);

  render(
    <UiCapabilityContextProvider value={capabilities(session)}>
      <Guarded />
    </UiCapabilityContextProvider>,
  );
}

afterEach(cleanup);

describe("given a page behind a flag and a permission", () => {
  describe("when the flag has not answered yet", () => {
    it("waits rather than reading the silence as off", () => {
      const access = resolveUiPageAccess({
        flags: ["release_ui_ai_governance_enabled"],
        permission: "governance:view",
        featureFlag: () => void 0,
        hasPermission: () => true,
        isSettled: () => true,
      });

      expect(access).toEqual({ kind: "loading" });
    });

    it("shows the loading fallback and never the page", () => {
      renderGuarded(
        new AnsweringSession({
          flags: {},
          permissions: ["governance:view"],
          settled: true,
        }),
      );

      expect(screen.getByText("still asking")).toBeDefined();
      expect(screen.queryByText("the page")).toBeNull();
    });
  });

  describe("when the flag is off", () => {
    it("answers not-found before it considers the permission at all", () => {
      const access = resolveUiPageAccess({
        flags: ["release_ui_ai_governance_enabled"],
        permission: "governance:view",
        featureFlag: () => false,
        // Holding the grant must not turn the 404 into a page.
        hasPermission: () => true,
        isSettled: () => true,
      });

      expect(access).toEqual({ kind: "not-found" });
    });

    it("answers not-found rather than forbidden to a viewer without the grant", () => {
      // The one case where the ORDER decides the answer. With the grant held,
      // both orderings agree and the assertion proves nothing; without it, a
      // permission-first guard would tell an outsider that a page they cannot
      // see exists and they merely lack access to it.
      const access = resolveUiPageAccess({
        flags: ["release_ui_ai_governance_enabled"],
        permission: "governance:view",
        featureFlag: () => false,
        hasPermission: () => false,
        isSettled: () => true,
      });

      expect(access).toEqual({ kind: "not-found" });
    });

    it("renders the not-found fallback to a viewer without the grant", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: false },
          permissions: [],
          settled: true,
        }),
      );

      expect(screen.getByText("not here")).toBeDefined();
      expect(screen.queryByText("missing governance:view")).toBeNull();
    });

    it("renders the not-found fallback for a viewer who holds the grant", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: false },
          permissions: ["governance:view"],
          settled: true,
        }),
      );

      expect(screen.getByText("not here")).toBeDefined();
      expect(screen.queryByText("the page")).toBeNull();
    });
  });

  describe("when the flag is on and the viewer lacks the grant", () => {
    /**
     * Carried from `platform/app/src/pages/governance/__tests__/delegatedViewer.integration.test.tsx`,
     * which drove the refusal through the page because the page carried the
     * guard. The page no longer does, and the two grants stay disjoint: an
     * organization manager without `governance:view` is refused here exactly
     * as the governance routers refuse them.
     *
     * @scenario "A principal who manages the organization but cannot read governance is refused"
     */
    /** @scenario "A principal who manages the organization but cannot read governance is refused" */
    it("refuses a principal who manages the organization but cannot read governance", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: true },
          permissions: ["organization:manage"],
          settled: true,
        }),
      );

      expect(screen.getByText("missing governance:view")).toBeDefined();
      expect(screen.queryByText("the page")).toBeNull();
    });

    it("names the missing permission back to them", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: true },
          permissions: [],
          settled: true,
        }),
      );

      expect(screen.getByText("missing governance:view")).toBeDefined();
      expect(screen.queryByText("the page")).toBeNull();
    });
  });

  describe("when the flag is on and the permission set has not arrived", () => {
    it("renders the page, so a page with its own loading state keeps it", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: true },
          permissions: [],
          settled: false,
        }),
      );

      expect(screen.getByText("the page")).toBeDefined();
    });
  });

  describe("when the flag is on and the viewer holds the grant", () => {
    it("opens the page", () => {
      renderGuarded(
        new AnsweringSession({
          flags: { release_ui_ai_governance_enabled: true },
          permissions: ["governance:view"],
          settled: true,
        }),
      );

      expect(screen.getByText("the page")).toBeDefined();
    });
  });

  describe("when a page names several flags", () => {
    it("asks every one of them rather than stopping at the first unanswered", () => {
      const asked: string[] = [];

      resolveUiPageAccess({
        flags: ["release_ui_ai_governance_enabled", "release_ui_governance_billed_cost_enabled"],
        featureFlag: (flag) => {
          asked.push(flag);
          return void 0;
        },
        hasPermission: () => true,
        isSettled: () => true,
      });

      expect(asked).toEqual([
        "release_ui_ai_governance_enabled",
        "release_ui_governance_billed_cost_enabled",
      ]);
    });
  });
});
