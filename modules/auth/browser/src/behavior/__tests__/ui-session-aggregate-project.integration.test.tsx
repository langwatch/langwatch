/**
 * An aggregate project takes no writes under it, whatever the reader's role (ADR-175
 * decision 8). The session asks the server's question, so no control offers a write the
 * server will refuse, while managing the aggregate and organisation writes stay open.
 * @vitest-environment jsdom
 */

import type { UiActiveScopeReading, UiSessionReading } from "@langwatch/browser-host/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useBrowserUiSession } from "../ui-session";
import { UI_EFFECTIVE_PERMISSIONS_PROCEDURE } from "../ui-session-queries";
import { answeringTransport, type ProcedureAnswer } from "./answering-transport.test-helpers";

const JANE: UiSessionReading = {
  status: "authenticated",
  user: { id: "user-jane", name: "Jane", email: null, image: null },
};

const ADMIN_GRANTS = ["datasets:manage", "traces:view", "project:manage", "organization:manage"];

const ASKED = ["datasets:create", "traces:view", "project:update", "organization:manage"] as const;

function scopeOn(kind: string): UiActiveScopeReading {
  return {
    status: "ready",
    organization: { id: "org-acme" },
    team: { id: "team-shared" },
    project: { id: "proj-1", slug: "acme-1", name: "ACME 1", kind },
  };
}

const answer: ProcedureAnswer = (path) =>
  path === UI_EFFECTIVE_PERMISSIONS_PROCEDURE
    ? Promise.resolve({ permissions: ADMIN_GRANTS })
    : Promise.reject(new Error(`No test answer for ${path}`));

function SessionProbe({ kind }: { kind: string }) {
  const session = useBrowserUiSession({
    transport: answeringTransport(answer),
    session: JANE,
    scope: scopeOn(kind),
    isPublicRoute: false,
  });
  return (
    <div>
      {ASKED.map((permission) => (
        <span key={permission} data-testid={permission}>
          {String(session.hasPermission(permission))}
        </span>
      ))}
      <span data-testid="organization-ask">
        {String(session.hasOrganizationPermission("datasets:create"))}
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

async function renderOn(kind: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProbe kind={kind} />
    </QueryClientProvider>,
  );
  dispose = () => view.unmount();
  await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
  return (testId: string) => view.getByTestId(testId).textContent;
}

describe("given an admin standing in an aggregate project", () => {
  describe("when a screen asks the session for a write under the project", () => {
    it("refuses it, through either question", async () => {
      const read = await renderOn("aggregate");

      expect(read("datasets:create")).toBe("false");
      expect(read("organization-ask")).toBe("false");
    });
  });

  describe("when a screen asks for a read, managing the project or an organisation write", () => {
    it("grants each of them", async () => {
      const read = await renderOn("aggregate");

      expect(read("traces:view")).toBe("true");
      expect(read("project:update")).toBe("true");
      expect(read("organization:manage")).toBe("true");
    });
  });
});

describe("given the same admin standing in an ordinary project", () => {
  describe("when a screen asks the session for a write under the project", () => {
    it("grants it", async () => {
      const read = await renderOn("application");

      expect(read("datasets:create")).toBe("true");
      expect(read("organization-ask")).toBe("true");
    });
  });
});
