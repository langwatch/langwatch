/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { UiFeedback, useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useActiveScope, usePermissions, useSession } from "@langwatch/ui-host/session";
import { trpcQueryKey } from "@langwatch/api/web";
import { createUiFeatureApiClient } from "../src/behavior/ui-feature-transport";
import { useBrowserUiSession } from "../src/behavior/ui-session";
import { UI_SESSION_QUERY_KEY, type UiAuthClient } from "../src/behavior/ui-session-client";
import { createUiFeatureShell } from "../src/ui/sections/ui-feature-shell";
import { JANE, organizationWith, PERSONAL_TEAM, SHARED_TEAM } from "./fixtures/ui-scope-graph";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

const noSignOut = () => Promise.resolve({});

function response(body: unknown, batch: boolean): Response {
  const result = { result: { data: body } };
  const payload = batch ? (body as unknown[]).map((item) => ({ result: { data: item } })) : result;
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function readInput(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const first = "0" in parsed ? (parsed as Record<string, unknown>)["0"] : parsed;
  if (typeof first !== "object" || first === null) return {};
  const json = (first as Record<string, unknown>).json;
  return typeof json === "object" && json !== null
    ? (json as Record<string, unknown>)
    : (first as Record<string, unknown>);
}

function sessionTransport(
  answer: (path: string, input: Record<string, unknown>) => Promise<unknown>,
) {
  return createUiFeatureApiClient({
    url: "http://localhost/api/trpc",
    fetch: async (request) => {
      const url = new URL(
        typeof request === "string" ? request : request.url,
        window.location.origin,
      );
      const path = url.pathname.split("/").at(-1) ?? "";
      const body = typeof request === "string" ? null : await request.clone().text();
      const rawInput = url.searchParams.get("input") ?? body;
      const paths = path.split(",");
      if (paths.length === 1) return response(await answer(path, readInput(rawInput)), false);

      const parsed: unknown = rawInput ? JSON.parse(rawInput) : {};
      const inputs = typeof parsed === "object" && parsed !== null ? parsed : {};
      const results = await Promise.all(
        paths.map((procedure, index) =>
          answer(
            procedure,
            readInput(JSON.stringify((inputs as Record<string, unknown>)[String(index)])),
          ),
        ),
      );
      return response(results, true);
    },
  });
}

function Probe() {
  const session = useSession();
  const scope = useActiveScope();
  const permissions = usePermissions();
  const port = useUiCapabilities().session;
  return (
    <div>
      <span data-testid="user">{session.user?.id ?? "none"}</span>
      <span data-testid="scope">{scope.status}</span>
      <span data-testid="project">{scope.project?.id ?? "none"}</span>
      <span data-testid="can-project">{String(permissions.can("annotations:update"))}</span>
      <span data-testid="can-org">
        {String(permissions.canInOrganization("annotations:update"))}
      </span>
      <span data-testid="legacy-can">{String(port.hasPermission("annotations:update"))}</span>
    </div>
  );
}

function mount({
  path,
  transport,
  authClient,
}: {
  path: string;
  transport: ReturnType<typeof createUiFeatureApiClient>;
  authClient: UiAuthClient;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Shell = createUiFeatureShell({
    apis: [],
    capabilities: { feedback: new SilentFeedback() },
    transport,
    session: ({ transport: mounted, feedback }) =>
      useBrowserUiSession({ transport: mounted, feedback, authClient }),
  });
  const routes = ["/:project/traces", "/share/:id"].map((routePath) => ({
    path: routePath,
    element: (
      <QueryClientProvider client={client}>
        <Shell>
          <Probe />
        </Shell>
      </QueryClientProvider>
    ),
  }));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return { ...view, client, router };
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

describe("BrowserUiSession transitions", () => {
  it("does not publish a prior actor's cached organization or grant while the next actor graph is delayed", async () => {
    let actor = JANE;
    const nextGraph = deferred<unknown>();
    const authClient: UiAuthClient = {
      $fetch: () =>
        Promise.resolve({
          data: { user: { id: actor, name: actor, email: `${actor}@example.com`, image: null } },
        }),
      signOut: noSignOut,
    };
    const transport = sessionTransport(async (path) => {
      if (path === "organization.getAll")
        return actor === JANE
          ? organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] })
          : nextGraph.promise;
      return { permissions: ["annotations:update"] };
    });
    const view = mount({ path: "/acme-app/traces", transport, authClient });
    await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
    actor = "user-new";
    await view.client.refetchQueries({ queryKey: UI_SESSION_QUERY_KEY });
    await waitFor(() => expect(view.getByTestId("scope").textContent).toBe("loading"));
    expect(view.getByTestId("project").textContent).toBe("none");
    expect(view.getByTestId("can-project").textContent).toBe("false");
    nextGraph.resolve([]);
  });

  it("keeps project grants out of organization permission checks", async () => {
    const authClient: UiAuthClient = {
      $fetch: () =>
        Promise.resolve({
          data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
        }),
      signOut: noSignOut,
    };
    const transport = sessionTransport(async (path, input) => {
      if (path === "organization.getAll")
        return organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });
      if (path === "authz.effectivePermissions")
        return "projectId" in input ? { permissions: ["annotations:update"] } : { permissions: [] };
      return { enabled: false };
    });
    const view = mount({ path: "/acme-app/traces", transport, authClient });
    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
    expect(view.getByTestId("can-org").textContent).toBe("false");
  });

  it("does not apply a late old-project grant after navigation selects another project", async () => {
    const oldGrant = deferred<unknown>();
    const authClient: UiAuthClient = {
      $fetch: () =>
        Promise.resolve({
          data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
        }),
      signOut: noSignOut,
    };
    const transport = sessionTransport(async (path, input) => {
      if (path === "organization.getAll")
        return organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });
      if (path === "authz.effectivePermissions") {
        return input.projectId === "proj-app" ? oldGrant.promise : { permissions: [] };
      }
      return { enabled: false };
    });
    const view = mount({ path: "/acme-app/traces", transport, authClient });
    await waitFor(() => expect(view.getByTestId("scope").textContent).toBe("ready"));
    await view.router.navigate("/personal-jane-abc123/traces");
    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-personal"));
    oldGrant.resolve({ permissions: ["annotations:update"] });
    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("false"));
  });

  it("clears cached grants from both permission readers when a refresh is refused", async () => {
    let refuse = false;
    let permissionRequests = 0;
    const authClient: UiAuthClient = {
      $fetch: () =>
        Promise.resolve({
          data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
        }),
      signOut: noSignOut,
    };
    const transport = sessionTransport(async (path) => {
      if (path === "organization.getAll")
        return organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });
      if (path === "authz.effectivePermissions") {
        permissionRequests += 1;
        if (refuse) throw new Error("refused");
        return { permissions: ["annotations:update"] };
      }
      return { enabled: false };
    });
    const view = mount({ path: "/acme-app/traces", transport, authClient });
    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
    await waitFor(() => expect(view.getByTestId("can-org").textContent).toBe("true"));
    const requestsBeforeRefresh = permissionRequests;
    refuse = true;
    await view.client.refetchQueries({ queryKey: trpcQueryKey("authz.effectivePermissions") });
    expect(permissionRequests).toBeGreaterThan(requestsBeforeRefresh);
    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("false"));
    expect(view.getByTestId("can-org").textContent).toBe("false");
    expect(view.getByTestId("legacy-can").textContent).toBe("false");
  });

  it.each(["pending", "failing"])(
    "hides the ambient project for a signed-in shared token while it is %s",
    async (outcome) => {
      const shared = deferred<unknown>();
      const authClient: UiAuthClient = {
        $fetch: () =>
          Promise.resolve({
            data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
          }),
        signOut: noSignOut,
      };
      const transport = sessionTransport(async (path) => {
        if (path === "organization.getAll")
          return organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] });
        if (path === "sharedTrace.get") return shared.promise;
        return { permissions: [] };
      });
      const view = mount({ path: "/share/token-1", transport, authClient });
      await waitFor(() => expect(view.getByTestId("scope").textContent).toBe("loading"));
      expect(view.getByTestId("project").textContent).toBe("none");
      if (outcome === "failing") {
        shared.reject(new Error("refused"));
        await waitFor(() => expect(view.getByTestId("scope").textContent).toBe("unavailable"));
        expect(view.getByTestId("project").textContent).toBe("none");
      }
    },
  );

  it.each(["pending", "failing"])(
    "keeps a token-resolved project ready when the signed-in viewer's organization graph is %s",
    async (outcome) => {
      const organizations = deferred<unknown>();
      let organizationRequested = false;
      const authClient: UiAuthClient = {
        $fetch: () =>
          Promise.resolve({
            data: {
              user: { id: JANE, name: "Jane", email: "jane@example.com", image: null },
            },
          }),
        signOut: noSignOut,
      };
      const transport = sessionTransport(async (path) => {
        if (path === "organization.getAll") {
          organizationRequested = true;
          return organizations.promise;
        }
        if (path === "sharedTrace.get") {
          return { project: { id: "shared-project", slug: "shared", name: "Shared" } };
        }
        return { permissions: [] };
      });
      const view = mount({ path: "/share/token-1", transport, authClient });
      await waitFor(() => expect(organizationRequested).toBe(true));
      if (outcome === "failing") organizations.reject(new Error("offline"));

      await waitFor(() => expect(view.getByTestId("scope").textContent).toBe("ready"));
      expect(view.getByTestId("project").textContent).toBe("shared-project");
    },
  );
});
