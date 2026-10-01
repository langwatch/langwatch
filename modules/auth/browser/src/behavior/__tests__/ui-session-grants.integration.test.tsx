/**
 * Grants as the scope beneath them moves: a grant resolved for one scope
 * must never answer for the next one, and a refused refresh must not leave
 * the last answer standing.
 * @vitest-environment jsdom
 */

import { trpcQueryKey } from "@langwatch/api/web";
import type { UiActiveScopeReading, UiSessionReading } from "@langwatch/browser-host/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useBrowserUiSession } from "../ui-session";
import { UI_EFFECTIVE_PERMISSIONS_PROCEDURE } from "../ui-session-queries";
import type { UiFeatureApiTransport } from "../ui-session-queries";
import { answeringTransport } from "./answering-transport.test-helpers";

const JANE: UiSessionReading = {
  status: "authenticated",
  user: { id: "user-jane", name: "Jane", email: null, image: null },
};

const ON_ACME_APP: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-acme" },
  team: { id: "team-shared" },
  project: { id: "proj-app", slug: "acme-app", name: "ACME App" },
};

const ON_PERSONAL: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-acme" },
  team: { id: "team-personal" },
  project: { id: "proj-personal", slug: "personal-jane", name: "Personal" },
};

const RESOLVING: UiActiveScopeReading = {
  status: "loading",
  organization: void 0,
  team: void 0,
  project: void 0,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => void 0;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function GrantProbe({
  transport,
  scope,
}: {
  transport: UiFeatureApiTransport;
  scope: UiActiveScopeReading;
}) {
  const session = useBrowserUiSession({ transport, session: JANE, scope });
  const { permissions } = session.snapshot();
  return (
    <div>
      <span data-testid="can-project">{String(permissions.can("annotations:update"))}</span>
      <span data-testid="can-org">
        {String(permissions.canInOrganization("annotations:update"))}
      </span>
    </div>
  );
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function renderGrants({
  transport,
  scope = ON_ACME_APP,
}: {
  transport: UiFeatureApiTransport;
  scope?: UiActiveScopeReading;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (standing: UiActiveScopeReading) => (
    <QueryClientProvider client={client}>
      <GrantProbe transport={transport} scope={standing} />
    </QueryClientProvider>
  );
  const view = render(tree(scope));
  dispose = () => view.unmount();
  return { ...view, client, moveTo: (next: UiActiveScopeReading) => view.rerender(tree(next)) };
}

describe("given grants answered for the scope the reader is standing in", () => {
  it("keeps project grants out of organization permission checks", async () => {
    const view = renderGrants({
      transport: answeringTransport((path, input) =>
        path === UI_EFFECTIVE_PERMISSIONS_PROCEDURE && "projectId" in input
          ? Promise.resolve({ permissions: ["annotations:update"] })
          : Promise.resolve({ permissions: [] }),
      ),
    });

    await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
    expect(view.getByTestId("can-org").textContent).toBe("false");
  });

  describe("when the scope goes back to resolving", () => {
    it("refuses the grant it had just answered, rather than reading it across", async () => {
      const view = renderGrants({
        transport: answeringTransport(() =>
          Promise.resolve({ permissions: ["annotations:update"] }),
        ),
      });
      await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));

      view.moveTo(RESOLVING);

      expect(view.getByTestId("can-project").textContent).toBe("false");
      expect(view.getByTestId("can-org").textContent).toBe("false");
    });
  });

  describe("when the reader moves to another project before the first answer lands", () => {
    it("never applies the late grant, because it was never about this project", async () => {
      const late = deferred<unknown>();
      const view = renderGrants({
        transport: answeringTransport((path, input) =>
          input.projectId === "proj-app" ? late.promise : Promise.resolve({ permissions: [] }),
        ),
      });

      view.moveTo(ON_PERSONAL);
      late.resolve({ permissions: ["annotations:update"] });

      await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("false"));
    });
  });

  describe("when a refresh of the grants is refused", () => {
    it("clears both readers rather than leaving the last answer standing", async () => {
      let refuse = false;
      const view = renderGrants({
        transport: answeringTransport(() =>
          refuse
            ? Promise.reject(new Error("refused"))
            : Promise.resolve({ permissions: ["annotations:update"] }),
        ),
      });
      await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
      await waitFor(() => expect(view.getByTestId("can-org").textContent).toBe("true"));

      refuse = true;
      await view.client.refetchQueries({
        queryKey: trpcQueryKey(UI_EFFECTIVE_PERMISSIONS_PROCEDURE),
      });

      await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("false"));
      expect(view.getByTestId("can-org").textContent).toBe("false");
    });
  });
});
