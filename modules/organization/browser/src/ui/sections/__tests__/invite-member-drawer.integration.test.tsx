/**
 * @vitest-environment jsdom
 * The invite drawer creates the invitation against the organization it was
 * opened for, and closes itself once it has.
 * @see specs/settings/add-member-drawer.feature
 */
import "@testing-library/jest-dom/vitest";
import { organizationApiCreateInvitesInputSchema } from "@langwatch/organization-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import { InviteMemberDrawer } from "../invite-member-drawer.tsx";

const calls = vi.hoisted(() => ({
  createInvites: vi.fn(),
  invalidated: [] as string[],
  created: [] as unknown[],
}));

vi.mock("../../../behavior/organization-api.ts", () => {
  const answers: Record<string, unknown> = {
    "plan.getActivePlan": { type: "ENTERPRISE", free: false, planSource: "subscription" },
    "licenseEnforcement.checkLimit": { allowed: true, current: 1, max: 100 },
  };

  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers[path] ?? [], isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({
      mutate: (input: unknown, handlers?: { onSuccess?: (data: unknown) => void }) => {
        if (path === "invite.createInvites") {
          calls.createInvites(input);
          handlers?.onSuccess?.(calls.created);
          return;
        }
        handlers?.onSuccess?.(void 0);
      },
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    invalidate: () => {
      calls.invalidated.push(path);
    },
    fetch: vi.fn(),
  });

  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;

  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

const CREATED_INVITE = {
  invite: { inviteCode: "code-1", email: "new@acme.com" },
  emailNotSent: false,
};

beforeEach(() => {
  calls.created = [CREATED_INVITE];
});

afterEach(() => {
  vi.clearAllMocks();
  calls.invalidated.length = 0;
  cleanup();
});

describe("the invite drawer", () => {
  describe("given it is open for an organization", () => {
    let host: FakeOrganizationHost;

    beforeEach(async () => {
      host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
      renderWithOrganizationHost(<InviteMemberDrawer open={true} />, host);

      await userEvent.type(
        screen.getByPlaceholderText("alice@example.com, bob@example.com"),
        "new@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: /send invites/i }));
    });

    /** @scenario Inviting through the drawer preserves organization and team scope */
    it("creates the invite against that organization and closes", async () => {
      await waitFor(() => expect(calls.createInvites).toHaveBeenCalled());
      expect(calls.createInvites.mock.calls[0]?.[0]).toMatchObject({
        organizationId: "org-1",
        invites: [expect.objectContaining({ email: "new@acme.com" })],
      });
      // What the drawer sends is what the procedure accepts, a team with no custom role included.
      expect(() =>
        organizationApiCreateInvitesInputSchema.parse(calls.createInvites.mock.calls[0]?.[0]),
      ).not.toThrow();
      await waitFor(() => expect(host.overlays).toContainEqual({ name: null }));
    });

    /** @scenario Invitation changes refresh the visible seat usage */
    it("drops the cached seat limits once an invitation is created", async () => {
      await waitFor(() => expect(calls.invalidated).toContain("licenseEnforcement.checkLimit"));
    });
  });

  describe("given the server answers the batch with no invitation created", () => {
    /** @scenario The invite drawer never reports success when no invitation was created */
    it("tells the admin nothing was sent and stays open", async () => {
      calls.created = [];
      const host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
      renderWithOrganizationHost(<InviteMemberDrawer open={true} />, host);

      await userEvent.type(
        screen.getByPlaceholderText("alice@example.com, bob@example.com"),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: /send invites/i }));

      await waitFor(() => expect(calls.createInvites).toHaveBeenCalled());
      expect(host.failures).toContainEqual(
        expect.objectContaining({ fallbackTitle: "No invitations were sent" }),
      );
      expect(host.successes).toEqual([]);
      expect(host.overlays).not.toContainEqual({ name: null });
    });
  });

  describe("given it opens from the inline invite box with the first letter typed", () => {
    it("focuses the email field, so the rest of the address lands there", async () => {
      const host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
      renderWithOrganizationHost(<InviteMemberDrawer open={true} initialEmail="t" />, host);
      const field = screen.getByPlaceholderText("alice@example.com, bob@example.com");

      await waitFor(() => expect(field).toHaveFocus());
      await userEvent.keyboard("om@acme.com");

      expect(field).toHaveValue("tom@acme.com");
    });
  });
});
