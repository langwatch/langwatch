/**
 * The session answers an organization permission from the active scope's one grant read, which
 * carries the organization's set too: specs/frontend/session-permission-reads.feature.
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
import {
  answeringTransport,
  type ProcedureAnswer,
  type ProcedureInput,
} from "./answering-transport.test-helpers";

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

/** Answers the active scope's grant read, and records every grant read sent. */
function grants({ project }: { project: () => Promise<unknown> }) {
  const reads: ProcedureInput[] = [];
  const answer: ProcedureAnswer = (path, input) => {
    if (path !== UI_EFFECTIVE_PERMISSIONS_PROCEDURE) {
      return Promise.reject(new Error(`No test answer for ${path}`));
    }
    reads.push(input);
    return project();
  };
  return { answer, reads };
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
      <span data-testid="read-members">
        {String(session.hasOrganizationPermission("members:view"))}
      </span>
      <span data-testid="read-members-on-project">
        {String(session.hasPermission("members:view"))}
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

describe("given the reader's grant in the active project lets them manage its organization", () => {
  describe("when a screen asks the session whether they may manage the organization", () => {
    /** @scenario "The session answers an organization permission from the active project's grant" */
    it("answers yes from the one grant read, which names the active project", async () => {
      const { answer, reads } = grants({
        project: () => Promise.resolve({ permissions: ["organization:manage"] }),
      });
      const view = renderSession(answer);

      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(view.getByTestId("manage-organization").textContent).toBe("true");
      expect(reads).toEqual([{ projectId: "proj-app" }]);
    });
  });
});

describe("given the reader's project grant manages the project but not its organization", () => {
  describe("when a screen asks the session", () => {
    /** @scenario "A project grant without the organization permission answers no for the organization" */
    it("refuses managing the organization and grants managing the project", async () => {
      const { answer } = grants({
        project: () => Promise.resolve({ permissions: ["project:manage"] }),
      });
      const view = renderSession(answer);

      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(view.getByTestId("manage-organization").textContent).toBe("false");
      expect(view.getByTestId("manage-project").textContent).toBe("true");
    });
  });
});

describe("given the reader holds no grant on the active project but is in the organization", () => {
  describe("when a screen asks whether they may read the organization's members", () => {
    /** @scenario "An organization permission held only at the organization answers yes on a project page" */
    it("answers yes for the organization and no for the project, from the one grant read", async () => {
      const { answer, reads } = grants({
        project: () =>
          Promise.resolve({ permissions: [], organizationPermissions: ["members:view"] }),
      });
      const view = renderSession(answer);

      await waitFor(() => expect(view.getByTestId("read-members").textContent).toBe("true"));
      expect(view.getByTestId("read-members-on-project").textContent).toBe("false");
      expect(reads).toEqual([{ projectId: "proj-app" }]);
    });
  });
});

describe("given the active project's grant read has not answered", () => {
  describe("when a screen asks the session for an organization permission", () => {
    /** @scenario "An organization permission is still unanswered while the active project's grants load" */
    it("answers no and does not report itself settled", async () => {
      const { answer } = grants({ project: () => new Promise(() => void 0) });
      const view = renderSession(answer);

      await waitFor(() => expect(view.getByTestId("manage-project").textContent).toBe("false"));
      expect(view.getByTestId("manage-organization").textContent).toBe("false");
      expect(view.getByTestId("settled").textContent).toBe("false");
    });
  });
});
