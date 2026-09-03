/**
 * @vitest-environment jsdom
 *
 * What each personal-workspace address is actually behind, proved by mounting
 * it.
 *
 * `personal-workspace-routes.unit.test.ts` pins which key each screen answers;
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering. Neither would notice
 * a loader that forgot the release flag — which is the failure that opens an
 * unreleased page — so this file loads the real loaders, mounts what they hand
 * back under a session that answers precisely, and reads the result.
 *
 * The screens themselves are faked, and so is the transport the host provider
 * reads the organization graph over. What is under test is the policy the
 * frontend feature wraps a screen in, and loading the whole personal workspace
 * over a live tRPC client to assert a refusal would test the screen instead.
 *
 * THE FLAG SCENARIOS OF THE TWO PROJECT PAGES LIVE HERE NOW. They were bound in
 * `platform/app`'s `pages/[project]/__tests__/coding-agent-pages.integration.test.tsx`,
 * where the guard was part of the page body; the guard is route policy now, so
 * the binding follows it.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/user-web/screens/personal-workspace", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/user-web/screens/personal-workspace")
  >("@langwatch/user-web/screens/personal-workspace");
  const Screen = () => <div>the personal page</div>;
  const emptyQuery = { data: undefined, isLoading: false, isSuccess: false };
  const apiNode = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          return apiNode();
        },
      },
    );
  return {
    ...actual,
    personalWorkspaceApi: apiNode(),
    personalWorkspaceScreens: new Proxy({}, { get: () => async () => ({ default: Screen }) }),
  };
});

// The eighth key rides the family's own screen entry, so the Proxy above already
// serves it. It is the one loader in this family that carries no flag and does
// carry the settings chrome, which is what makes it worth mounting here beside
// the seven.

// The harvested settings chrome reads the plan and the membership role over the
// application's transport, neither of which is what this file is about.
vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
  useUiPlatformAdmin: () => false,
}));

import { MemoryRouter } from "react-router";
import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "../src/behavior/ui-capabilities";
import { personalWorkspacePageLoaders } from "../src/features/personal-workspace";

const FLAG = "release_ui_ai_governance_enabled";

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
  constructor(private readonly flags: Record<string, boolean | undefined>) {
    super();
  }

  currentUser(): UiActor | null {
    return null;
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: null };
  }

  hasPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(flag: string): boolean | undefined {
    return this.flags[flag];
  }
}

const documentTarget = { title: "" };

function capabilities(session: UiSessionPort): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create(documentTarget),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session,
  };
}

async function openPage(key: string, flags: Record<string, boolean | undefined>): Promise<void> {
  const loader = personalWorkspacePageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders. The query client is there for the
  // host provider, which builds the session refresher the avatar control asks
  // for; the shell always has one and this is the smallest way to say so. The
  // router is there for the settings key: the harvested chrome reads the
  // address to decide which settings group is open.
  render(
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[key.replace(/^pages/, "")]}>
          <UiCapabilityContextProvider value={capabilities(new AnsweringSession(flags))}>
            <Mounted />
          </UiCapabilityContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  documentTarget.title = "";
});

describe("given the personal workspace is released for the organization", () => {
  it("opens every one of its addresses", async () => {
    for (const key of Object.keys(personalWorkspacePageLoaders)) {
      await openPage(key, { [FLAG]: true });
      expect(screen.getByText("the personal page")).toBeDefined();
      cleanup();
    }
  });

  it("names the page in the browser tab", async () => {
    await openPage("pages/me/index", { [FLAG]: true });

    expect(documentTarget.title).toBe("My Usage · LangWatch");
  });
});

describe("given the personal workspace is not released for the organization", () => {
  it("reads as a page that is not here, and never as a refusal", async () => {
    await openPage("pages/me/index", { [FLAG]: false });

    expect(screen.queryByText("the personal page")).toBeNull();
    expect(screen.getByText("This page is not here")).toBeDefined();
  });

  it("leaves the browser tab alone rather than naming a page that did not open", async () => {
    await openPage("pages/me/index", { [FLAG]: false });

    expect(documentTarget.title).toBe("");
  });

  /** @scenario "The pages stay closed when they are not released" */
  it("does not open the project Sessions page", async () => {
    await openPage("pages/[project]/sessions", { [FLAG]: false });

    expect(screen.queryByText("the personal page")).toBeNull();
    expect(screen.getByText("This page is not here")).toBeDefined();
  });

  /** @scenario "The pages stay closed when they are not released" */
  it("does not open the project Pull requests page", async () => {
    await openPage("pages/[project]/pull-requests", { [FLAG]: false });

    expect(screen.queryByText("the personal page")).toBeNull();
    expect(screen.getByText("This page is not here")).toBeDefined();
  });
});

describe("given the flag has not answered yet", () => {
  it("waits rather than flashing a page that is not here", async () => {
    await openPage("pages/me/index", {});

    expect(screen.queryByText("This page is not here")).toBeNull();
    expect(screen.queryByText("the personal page")).toBeNull();
  });
});
