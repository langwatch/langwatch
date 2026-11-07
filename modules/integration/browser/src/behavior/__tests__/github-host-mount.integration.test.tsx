// @vitest-environment jsdom
/**
 * The GitHub host mount's Langy wiring: who is offered Langy, and what an ask does.
 * Spec: modules/integration/specs/langwatch-mcp-banner.feature
 */
import {
  UiFeedback,
  UiHostServiceProvider,
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiFailureNotice,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import type { LangyAsk } from "@langwatch/langy-client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lent = vi.hoisted(() => ({
  load: undefined as (() => Promise<LangyAsk>) | undefined,
}));
vi.mock("@langwatch/browser-host/lent", () => ({ useLentOperations: () => lent.load }));

import { useGithubHost, type GithubHostApi } from "../../model/github-host.ts";
import GithubHostMount from "../github-host-mount.tsx";

class PermissionSession extends UiSession {
  constructor(private readonly granted: ReadonlySet<string>) {
    super();
  }

  currentUser() {
    return null;
  }

  hasPermission(permission: string): boolean {
    return this.granted.has(permission);
  }

  isSettled(): boolean {
    return true;
  }
}

class OrganizationScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: null };
  }
}

class RecordingFeedback extends UiFeedback {
  readonly failures: UiFailureNotice[] = [];
  succeeded(): void {}
  warned(): void {}
  informed(): void {}
  failed(failure: UiFailureNotice): void {
    this.failures.push(failure);
  }
}

function mount({ released, permissions }: { released: boolean; permissions: readonly string[] }): {
  host: () => GithubHostApi;
  feedback: RecordingFeedback;
} {
  const feedback = new RecordingFeedback();
  const services: UiHostServices = {
    ...createUiHostServicesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new PermissionSession(new Set(permissions)),
    ),
    feedback,
    scope: new OrganizationScope(),
  };
  const flags = {
    flag: ({ name }: { name: string }) => (name === "release_langy_enabled" ? released : void 0),
  };
  let read: GithubHostApi | undefined;
  function Reader() {
    read = useGithubHost();
    return null;
  }
  render(
    <UiHostServiceProvider value={new Map([[UiFlagsService.name, flags]])}>
      <UiHostServicesContextProvider value={services}>
        <GithubHostMount>
          <Reader />
        </GithubHostMount>
      </UiHostServicesContextProvider>
    </UiHostServiceProvider>,
  );
  return {
    host: () => {
      if (!read) throw new Error("the mount rendered no host");
      return read;
    },
    feedback,
  };
}

afterEach(() => {
  cleanup();
  lent.load = undefined;
});

describe("the GitHub host mount's Langy wiring", () => {
  describe("given Langy lends its ask", () => {
    /** @scenario "Only someone who may ask Langy is offered it" */
    it("offers Langy only when it is rolled out and the person holds langy:create", () => {
      lent.load = () => Promise.resolve({ ask: vi.fn(), onScreen: vi.fn() });

      expect(
        mount({ released: true, permissions: ["langy:create"] })
          .host()
          .canAskLangy(),
      ).toBe(true);
      cleanup();
      expect(
        mount({ released: false, permissions: ["langy:create"] })
          .host()
          .canAskLangy(),
      ).toBe(false);
      cleanup();
      expect(mount({ released: true, permissions: [] }).host().canAskLangy()).toBe(false);
    });

    /** @scenario "The ask reaches Langy, and a Langy that cannot open is reported" */
    it("loads the lent ask and hands it the question", async () => {
      const ask = vi.fn();
      lent.load = () => Promise.resolve({ ask, onScreen: vi.fn() });
      const { host } = mount({ released: true, permissions: ["langy:create"] });

      host().askLangy("Help me connect the LangWatch MCP");

      await vi.waitFor(() =>
        expect(ask).toHaveBeenCalledWith({ question: "Help me connect the LangWatch MCP" }),
      );
    });

    /** @scenario "The ask reaches Langy, and a Langy that cannot open is reported" */
    it("reports a lent ask that fails to load", async () => {
      const error = new Error("chunk failed");
      lent.load = () => Promise.reject(error);
      const { host, feedback } = mount({ released: true, permissions: ["langy:create"] });

      host().askLangy("Help me connect the LangWatch MCP");

      await vi.waitFor(() =>
        expect(feedback.failures).toEqual([{ error, fallbackTitle: "Langy could not open" }]),
      );
    });
  });

  describe("given Langy is not installed", () => {
    /** @scenario "Without Langy the banner offers only the docs" */
    it("never offers Langy", () => {
      expect(
        mount({ released: true, permissions: ["langy:create"] })
          .host()
          .canAskLangy(),
      ).toBe(false);
    });
  });
});
