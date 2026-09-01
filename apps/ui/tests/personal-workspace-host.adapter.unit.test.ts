/**
 * The personal-workspace package's host port, answered from this application.
 *
 * The adapter is a value object over readings that have already happened, which
 * is what makes it assertable without a router, a transport or a document. What
 * is worth pinning is the two decisions it makes rather than forwards — which
 * organization this page is about and which project the address is standing in,
 * both resolved out of the graph already in hand rather than asked for again —
 * and the one action that is neither a navigation nor a notice.
 */

import { describe, expect, it, vi } from "vitest";
import { UiPersonalWorkspaceHost } from "../src/features/personal-workspace/behavior/personal-workspace-host.adapter";

const CHECKOUT = {
  id: "project_1",
  name: "Checkout",
  slug: "checkout",
  teamId: "team_1",
};

const ACME = {
  id: "org_acme",
  name: "ACME",
  slug: "acme",
  teams: [{ id: "team_1", name: "Platform", projects: [CHECKOUT] }],
};

const OTHER = { id: "org_other", name: "Other", slug: "other", teams: [] };

function host(
  options: {
    organizationId?: string | null;
    projectId?: string | null;
    organizationRole?: string | undefined;
    isScopeResolved?: boolean;
    actions?: Partial<Parameters<typeof UiPersonalWorkspaceHost.create>[1]>;
  } = {},
) {
  const {
    organizationId = "org_acme",
    projectId = null,
    isScopeResolved = true,
    actions = {},
  } = options;
  // Presence rather than a default: "no role has arrived" is a real reading and
  // `?? "MEMBER"` would erase it.
  const organizationRole = "organizationRole" in options ? options.organizationRole : "MEMBER";
  return UiPersonalWorkspaceHost.create(
    {
      scope: { organizationId, projectId },
      organizations: [ACME, OTHER],
      organizationRole,
      isScopeResolved,
      currentUser: { id: "user_1", name: "Carol", email: "carol@acme.test", image: null },
      deployment: { isSaas: true, appBaseUrl: "https://app.langwatch.ai" },
      route: { params: {}, query: {} },
    },
    {
      hasPermission: () => false,
      isFeatureEnabled: () => false,
      setQuery: () => {},
      navigate: () => {},
      refreshSession: () => Promise.resolve(),
      succeeded: () => {},
      failed: () => {},
      ...actions,
    },
  );
}

describe("given the organization graph is already in hand", () => {
  describe("when a screen asks which organization it is about", () => {
    it("resolves it from the scope rather than from the first row", () => {
      expect(host({ organizationId: "org_other" }).organization()).toBe(OTHER);
    });

    it("has none when the scope names none", () => {
      expect(host({ organizationId: null }).organization()).toBeUndefined();
    });
  });

  describe("when a project-scoped screen asks which project it is about", () => {
    it("finds it anywhere in the graph, under whichever team holds it", () => {
      expect(host({ projectId: "project_1" }).project()).toBe(CHECKOUT);
    });

    it("has none when the scope names none, which is not the same as none existing", () => {
      const resolving = host({ projectId: null, isScopeResolved: false });

      expect(resolving.project()).toBeUndefined();
      expect(resolving.isScopeResolved()).toBe(false);
    });
  });

  describe("when a surface asks what the reader's standing is", () => {
    it("hands back the role the graph carried", () => {
      expect(host({ organizationRole: "EXTERNAL" }).organizationRole()).toBe("EXTERNAL");
    });

    it("hands back nothing while the graph is still arriving", () => {
      expect(host({ organizationRole: void 0 }).organizationRole()).toBeUndefined();
    });
  });
});

describe("given a screen changed something about the reader", () => {
  describe("when it asks for the session to be read again", () => {
    it("hands the request to the application rather than reading it itself", async () => {
      const refreshSession = vi.fn(() => Promise.resolve());

      await host({ actions: { refreshSession } }).refreshSession();

      expect(refreshSession).toHaveBeenCalledTimes(1);
    });
  });
});
