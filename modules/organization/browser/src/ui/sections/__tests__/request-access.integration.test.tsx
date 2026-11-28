import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
/**
 * @vitest-environment jsdom
 * Request access, as a refusal draws it for a Lite Member, and draws nothing for anybody else.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import type { MyAccessRequest } from "@langwatch/organization-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationHostProvider } from "../../../model/organization-host.ts";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import RequestAccessAction from "../request-access.tsx";

const state = vi.hoisted(() => ({
  mine: { status: "none", openedAt: null, resolvedAt: null } as MyAccessRequest,
  sent: [] as unknown[],
  failing: false,
}));

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    useUtils: () => ({ seatRequest: { myAccessRequest: { invalidate: async () => {} } } }),
    seatRequest: {
      myAccessRequest: {
        useQuery: () => ({ data: state.mine, isPending: false }),
      },
      requestAccess: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            state.sent.push(input);
            if (state.failing) throw new Error("seat_request_not_found");
            return { status: "open", openedAt: 1, resolvedAt: null } satisfies MyAccessRequest;
          },
        }),
      },
    },
  },
}));

const liteMember = () => new FakeOrganizationHost({ isLiteMember: true });

// The real mount reads the shell's capabilities; this one hands in the same Lite Member host.
vi.mock("../../../behavior/organization-host-mount.tsx", () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <OrganizationHostProvider value={liteMember()}>{children}</OrganizationHostProvider>
  ),
}));

function answered(status: MyAccessRequest["status"]) {
  state.mine = { status, openedAt: status === "none" ? null : 1, resolvedAt: null };
}

describe("Request access", () => {
  afterEach(() => {
    cleanup();
    answered("none");
    state.sent = [];
    state.failing = false;
  });

  describe("given a Lite Member refused for want of a full seat", () => {
    /** @scenario "The Lite Member refusal offers Request access" */
    it("sends the request with what they were doing and says the admins were told", async () => {
      renderWithOrganizationHost(<RequestAccessAction reason="run_experiments" />, liteMember());

      await userEvent.click(screen.getByRole("button", { name: "Request access" }));

      expect(state.sent).toEqual([{ organizationId: "org-1", reason: "run_experiments" }]);
      expect(await screen.findByRole("button", { name: "Access requested" })).toBeDisabled();
      expect(screen.getByText(/admins were told/)).toBeInTheDocument();
    });

    /** @scenario "A request that could not be sent keeps the button" */
    it("shows the error and keeps Request access to press again", async () => {
      state.failing = true;
      const { host } = renderWithOrganizationHost(<RequestAccessAction />, liteMember());

      await userEvent.click(screen.getByRole("button", { name: "Request access" }));

      await waitFor(() =>
        expect(host.failures).toEqual([
          expect.objectContaining({ fallbackTitle: "Couldn't send your access request" }),
        ]),
      );
      expect(screen.getByRole("button", { name: "Request access" })).toBeEnabled();
    });
  });

  describe("given the request was sent from this page and later answered", () => {
    it("shows the answer once the reread knows of it", async () => {
      const { rerenderWithHost } = renderWithOrganizationHost(
        <RequestAccessAction />,
        liteMember(),
      );
      await userEvent.click(screen.getByRole("button", { name: "Request access" }));
      expect(await screen.findByRole("button", { name: "Access requested" })).toBeDisabled();

      answered("approved");
      rerenderWithHost(liteMember());

      expect(await screen.findByText("Your full seat was approved.")).toBeInTheDocument();
    });
  });

  describe("given the member's request was answered", () => {
    /** @scenario "Request access says what was answered" */
    it("says an approval landed and offers to reload", () => {
      answered("approved");
      renderWithOrganizationHost(<RequestAccessAction />, liteMember());

      expect(screen.getByText("Your full seat was approved.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    });

    /** @scenario "Request access says what was answered" */
    it("says an admin declined it and offers to ask again", async () => {
      answered("declined");
      renderWithOrganizationHost(<RequestAccessAction />, liteMember());

      expect(screen.getByText("An admin declined your request.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Ask again" }));
      expect(state.sent).toHaveLength(1);
    });
  });

  describe("given a modal drawn outside the organization host, like licensing's restriction", () => {
    /** @scenario "Request access works in a modal drawn outside the organization pages" */
    it("mounts its own host and still offers Request access", () => {
      render(
        <DesignSystemTestProvider>
          <RequestAccessAction reason="run_experiments" />
        </DesignSystemTestProvider>,
      );

      expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    });
  });

  describe("given a Lite Member refused for an admin-only permission", () => {
    /** @scenario "An admin-only refusal offers no Request access" */
    it("draws nothing for project:manage and still offers it for a member's permission", () => {
      const { container } = renderWithOrganizationHost(
        <RequestAccessAction reason="change_project_settings" permission="project:manage" />,
        liteMember(),
      );
      expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
      expect(container.querySelector("[data-testid='request-access']")).toBeNull();
      cleanup();

      renderWithOrganizationHost(
        <RequestAccessAction reason="run_experiments" permission="evaluations:manage" />,
        liteMember(),
      );
      expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    });
  });

  describe("given a reader on a full seat", () => {
    /** @scenario "A full member is not offered Request access" */
    it("draws nothing and asks nothing", () => {
      const { container } = renderWithOrganizationHost(
        <RequestAccessAction reason="run_experiments" />,
        new FakeOrganizationHost({ isLiteMember: false }),
      );

      expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
      expect(container.querySelector("[data-testid='request-access']")).toBeNull();
    });
  });
});
