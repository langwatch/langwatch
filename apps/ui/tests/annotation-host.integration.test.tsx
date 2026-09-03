/**
 * @vitest-environment jsdom
 *
 * The annotations host provider, and the two readings it derives rather than
 * forwards.
 *
 * WHAT IS DERIVED, AND WHY IT IS PINNED HERE:
 *
 * - `isOwnPersonalWorkspace` decides whether handing rows to a dataset has to
 *   ask first. It is a column on the TEAM crossed with who is signed in, not a
 *   grant, and `personalWorkspaceFeatures.get` answers NOT_FOUND for anybody
 *   else's workspace — so answering it wrong in either direction is visible:
 *   `true` gates a reader out of their own hand-off, `false` sends a read that
 *   refuses for everyone who is not on their own personal project.
 * - The send confirmation's LINK. The shared feedback capability carries a
 *   title and a description and no action, so a notice that has one is rendered
 *   on the Design System toaster's own action trigger instead. Everything
 *   without one still goes through the capability, which is what keeps the
 *   code-keyed copy deciding the words a customer reads.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));
const graph = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: (options: Record<string, unknown>) => toasts.created.push(options) },
}));

vi.mock("@langwatch/annotation-web/screens/annotations", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/annotation-web/screens/annotations")
  >("@langwatch/annotation-web/screens/annotations");
  return {
    ...actual,
    annotationApi: {
      organization: { getAll: { useQuery: () => ({ data: graph.data }) } },
    },
  };
});

vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
}));

import {
  type AnnotationHostPort,
  useAnnotationHost,
} from "@langwatch/annotation-web/screens/annotations";
import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
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
import { withHost } from "../src/ui/sections/ui-page";
import { AnnotationHost } from "../src/features/annotation/ui/sections/annotation-host";

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

class RecordingFeedback extends UiFeedbackPort {
  readonly successes: UiSuccessNotice[] = [];
  succeeded(notice: UiSuccessNotice): void {
    this.successes.push(notice);
  }
  failed(_: UiFailureNotice): void {}
}

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

class ScopedSession extends UiSessionPort {
  constructor(private readonly userId: string) {
    super();
  }
  currentUser(): UiActor {
    return { id: this.userId, name: "Ana", email: null, image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: "proj_1" };
  }
  hasPermission(): boolean {
    return true;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return true;
  }
}

/** Mounts the provider and hands back the host it published. */
function mountHost(userId: string): {
  host: AnnotationHostPort;
  feedback: RecordingFeedback;
} {
  let published: AnnotationHostPort | undefined;
  const Reader = () => {
    published = useAnnotationHost();
    return null;
  };
  const Mounted = withHost(AnnotationHost, Reader);
  const feedback = new RecordingFeedback();
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback,
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new ScopedSession(userId),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities}>
        <Mounted />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
  if (!published) throw new Error("the provider published no host");
  return { host: published, feedback };
}

beforeEach(() => {
  toasts.created = [];
  graph.data = [
    {
      id: "org_1",
      name: "Acme",
      teams: [
        {
          id: "team_1",
          name: "Ana's workspace",
          isPersonal: true,
          ownerUserId: "user_1",
          projects: [{ id: "proj_1", name: "Personal", slug: "personal" }],
        },
      ],
    },
  ];
});
afterEach(cleanup);

describe("given the project in scope is a personal workspace", () => {
  describe("when its owner is the reader", () => {
    it("says so, so the dataset hand-off asks before it opens", () => {
      const { host } = mountHost("user_1");

      expect(host.isOwnPersonalWorkspace()).toBe(true);
      expect(host.project()).toEqual({
        id: "proj_1",
        slug: "personal",
        name: "Personal",
      });
    });
  });

  describe("when its owner is somebody else", () => {
    it("says no, because the bundle only exists on a reader's own workspace", () => {
      const { host } = mountHost("user_2");

      expect(host.isOwnPersonalWorkspace()).toBe(false);
    });
  });
});

describe("given the project in scope is an ordinary team project", () => {
  describe("when the reader opens it", () => {
    it("says no, whoever they are", () => {
      graph.data = [
        {
          id: "org_1",
          name: "Acme",
          teams: [
            {
              id: "team_1",
              name: "Core",
              isPersonal: false,
              ownerUserId: "user_1",
              projects: [{ id: "proj_1", name: "Core", slug: "core" }],
            },
          ],
        },
      ];

      expect(mountHost("user_1").host.isOwnPersonalWorkspace()).toBe(false);
    });
  });
});

describe("given a confirmation the screen wants a link on", () => {
  describe("when it carries an action", () => {
    it("renders it on the toaster's own action trigger", () => {
      const { host, feedback } = mountHost("user_1");
      const perform = vi.fn();

      host.succeeded({
        title: "Added to annotation queue",
        description: "2 traces sent for annotation",
        action: { label: "View queue", perform },
      });

      expect(feedback.successes).toEqual([]);
      expect(toasts.created).toHaveLength(1);
      const toast = toasts.created[0]!;
      expect(toast.title).toBe("Added to annotation queue");
      expect((toast.action as { label: string }).label).toBe("View queue");
      (toast.action as { onClick: () => void }).onClick();
      expect(perform).toHaveBeenCalled();
    });
  });

  describe("when it carries none", () => {
    it("goes through the feedback capability, so the code-keyed copy still decides", () => {
      const { host, feedback } = mountHost("user_1");

      host.succeeded({ title: "Removed from queue", description: "2 items removed" });

      expect(toasts.created).toEqual([]);
      expect(feedback.successes).toEqual([
        { title: "Removed from queue", description: "2 items removed" },
      ]);
    });
  });
});
