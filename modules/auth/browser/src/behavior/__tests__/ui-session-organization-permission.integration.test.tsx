/**
 * The session answers an organization permission itself, from the organization's own
 * grants: specs/frontend/session-permission-reads.feature (plan batch 1).
 * @vitest-environment jsdom
 */

import type { UiActiveScopeReading, UiSessionReading } from "@langwatch/browser-host/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useBrowserUiSession } from "../ui-session";
import {
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  type UiFeatureApiTransport,
} from "../ui-session-queries";
import { answeringTransport, type ProcedureAnswer } from "./answering-transport.test-helpers";

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

/** A project read names the project; the organization read names only the organization. */
function grants({
  project,
  organization,
}: {
  project: () => Promise<unknown>;
  organization: () => Promise<unknown>;
}): ProcedureAnswer {
  return (path, input) => {
    if (path !== UI_EFFECTIVE_PERMISSIONS_PROCEDURE) {
      return Promise.reject(new Error(`No test answer for ${path}`));
    }
    return "projectId" in input ? project() : organization();
  };
}

function SessionProbe({ transport }: { transport: UiFeatureApiTransport }) {
  const session = useBrowserUiSession({
    transport,
    session: JANE,
    scope: ON_ACME_APP,
    isPublicRoute: false,
  });
  return (
    <div>
      <span data-testid="manage-project">{String(session.hasPermission("project:manage"))}</span>
      <span data-testid="manage-organization">
        {String(session.hasOrganizationPermission("organization:manage"))}
      </span>
      <span data-testid="settled">{String(session.isSettled())}</span>
    </div>
  );
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function renderSession(answer: ProcedureAnswer) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProbe transport={answeringTransport(answer)} />
    </QueryClientProvider>,
  );
  dispose = () => view.unmount();
  return view;
}

describe("given the reader can manage a project but cannot manage its organization", () => {
  describe("when a screen asks the session", () => {
    /** @scenario "The session answers an organization permission on its own" */
    it("refuses managing the organization and grants managing the project", async () => {
      const view = renderSession(
        grants({
          project: () => Promise.resolve({ permissions: ["project:manage"] }),
          organization: () => Promise.resolve({ permissions: ["organization:view"] }),
        }),
      );

      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(view.getByTestId("manage-organization").textContent).toBe("false");
      expect(view.getByTestId("manage-project").textContent).toBe("true");
    });
  });
});

describe("given the organization's grant read has not answered", () => {
  describe("when a screen asks the session for an organization permission", () => {
    /** @scenario "An organization permission is still unanswered while the organization's grants load" */
    it("answers no and does not report itself settled", async () => {
      const view = renderSession(
        grants({
          project: () => Promise.resolve({ permissions: ["project:manage"] }),
          organization: () => new Promise(() => void 0),
        }),
      );

      await waitFor(() => expect(view.getByTestId("manage-project").textContent).toBe("true"));
      expect(view.getByTestId("manage-organization").textContent).toBe("false");
      expect(view.getByTestId("settled").textContent).toBe("false");
    });
  });
});
