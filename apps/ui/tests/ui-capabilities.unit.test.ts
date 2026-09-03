import { describe, expect, it } from "vitest";
import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityUnavailableError,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "../src/behavior/ui-capabilities";

class RecordingNavigation extends UiNavigationPort {
  readonly moves: string[] = [];

  navigate(to: string): void {
    this.moves.push(`navigate ${to}`);
  }

  replace(to: string): void {
    this.moves.push(`replace ${to}`);
  }

  back(): void {
    this.moves.push("back");
  }
}

class RecordingRoute extends UiRoutePort {
  readonly writes: Readonly<Record<string, string | undefined>>[] = [];

  reading() {
    return { params: {}, query: {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.writes.push(next);
  }
}

const recordingRoute = (): UiRoutePort => new RecordingRoute();

class RecordingFeedback extends UiFeedbackPort {
  readonly notices: (UiSuccessNotice | UiFailureNotice)[] = [];

  succeeded(notice: UiSuccessNotice): void {
    this.notices.push(notice);
  }

  failed(failure: UiFailureNotice): void {
    this.notices.push(failure);
  }
}

/** A live session that must never be reached when an install outranks it. */
class UnusableSession extends UiSessionPort {
  currentUser(): never {
    throw new Error("the installed session should have answered");
  }

  activeScope(): never {
    throw new Error("the installed session should have answered");
  }

  hasPermission(): never {
    throw new Error("the installed session should have answered");
  }

  isSettled(): never {
    throw new Error("the installed session should have answered");
  }

  featureFlag(): never {
    throw new Error("the installed session should have answered");
  }
}

class StubSession extends UiSessionPort {
  currentUser() {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
  }

  activeScope() {
    return { organizationId: "org_1", projectId: "project_1" };
  }

  hasPermission(permission: string): boolean {
    return permission === "prompt:read";
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return false;
  }
}

describe("given the capability ports a screen asks instead of reaching for the browser", () => {
  describe("when the composing application installs none of them", () => {
    it("takes the defaults this package can build for the document title and navigation", () => {
      const navigation = new RecordingNavigation();
      const documentTitle = BrowserUiDocumentTitle.create({ title: "" });

      const capabilities = resolveUiCapabilities({
        install: {},
        documentTitle,
        navigation,
        route: recordingRoute(),
      });

      expect(capabilities.navigation).toBe(navigation);
      expect(capabilities.documentTitle).toBe(documentTitle);
    });

    it("refuses feedback by name rather than swallowing what the user should read", () => {
      const capabilities = resolveUiCapabilities({
        install: {},
        documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
        navigation: new RecordingNavigation(),
        route: recordingRoute(),
      });

      expect(() =>
        capabilities.feedback.failed({ error: new Error("boom"), fallbackTitle: "Couldn't save" }),
      ).toThrow(UiCapabilityUnavailableError);
      expect(() => capabilities.feedback.succeeded({ title: "Saved" })).toThrow(
        /"feedback" UI capability has no implementation/,
      );
    });

    it("refuses the session by name rather than answering an empty permission set", () => {
      const capabilities = resolveUiCapabilities({
        install: {},
        documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
        navigation: new RecordingNavigation(),
        route: recordingRoute(),
      });

      expect(() => capabilities.session.hasPermission("prompt:read")).toThrow(
        /"session" UI capability has no implementation/,
      );
      expect(() => capabilities.session.currentUser()).toThrow(UiCapabilityUnavailableError);
      expect(() => capabilities.session.activeScope()).toThrow(UiCapabilityUnavailableError);
      expect(() => capabilities.session.isFeatureEnabled("some_flag")).toThrow(
        UiCapabilityUnavailableError,
      );
    });
  });

  describe("when the application composed a live session of its own", () => {
    it("answers with it, so a mounted composition stops refusing", () => {
      const session = new StubSession();

      const capabilities = resolveUiCapabilities({
        install: {},
        documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
        navigation: new RecordingNavigation(),
        route: recordingRoute(),
        session,
      });

      expect(capabilities.session).toBe(session);
    });

    it("still lets an installed session win over it", () => {
      const installed = new StubSession();

      const capabilities = resolveUiCapabilities({
        install: { session: installed },
        documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
        navigation: new RecordingNavigation(),
        route: recordingRoute(),
        session: new UnusableSession(),
      });

      expect(capabilities.session).toBe(installed);
    });
  });

  describe("when the composing application installs an implementation", () => {
    it("uses the installed port over every default", () => {
      const feedback = new RecordingFeedback();
      const session = new StubSession();
      const installedNavigation = new RecordingNavigation();

      const capabilities = resolveUiCapabilities({
        install: { feedback, session, navigation: installedNavigation },
        documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
        navigation: new RecordingNavigation(),
        route: recordingRoute(),
      });

      capabilities.feedback.succeeded({ title: "Saved" });
      capabilities.navigation.replace("/settings");

      expect(feedback.notices).toEqual([{ title: "Saved" }]);
      expect(installedNavigation.moves).toEqual(["replace /settings"]);
      expect(capabilities.session.hasPermission("prompt:read")).toBe(true);
    });
  });
});

describe("given the document title capability", () => {
  describe("when a screen sets the title", () => {
    it("writes it to the document it was built over", () => {
      const target = { title: "LangWatch" };

      BrowserUiDocumentTitle.create(target).set("Prompt Studio");

      expect(target.title).toBe("Prompt Studio");
    });
  });

  describe("when the screen that set the title is torn down", () => {
    it("restores the title the document had before it", () => {
      const target = { title: "LangWatch" };

      const restore = BrowserUiDocumentTitle.create(target).set("Prompt Studio");
      restore();

      expect(target.title).toBe("LangWatch");
    });
  });

  describe("when two screens set the title in turn", () => {
    it("restores each to what it found, not to the original", () => {
      const target = { title: "LangWatch" };
      const capability = BrowserUiDocumentTitle.create(target);

      const restoreFirst = capability.set("Prompts");
      const restoreSecond = capability.set("Prompt Studio");
      restoreSecond();

      expect(target.title).toBe("Prompts");

      restoreFirst();

      expect(target.title).toBe("LangWatch");
    });
  });
});
