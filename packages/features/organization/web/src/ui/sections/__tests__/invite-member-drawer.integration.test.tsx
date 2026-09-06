/**
 * @vitest-environment jsdom
 * The invite drawer creates the invitation against the organization it was
 * opened for, and closes itself once it has.
 * @see specs/settings/add-member-drawer.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing";
import { InviteMemberDrawer } from "../invite-member-drawer";

const calls = vi.hoisted(() => ({ createInvites: vi.fn() }));

vi.mock("../../../behavior/organization-api", () => {
  const answers: Record<string, unknown> = {
    "plan.getActivePlan": { type: "ENTERPRISE", free: false, planSource: "subscription" },
    "licenseEnforcement.checkLimit": { allowed: true, current: 1, max: 100 },
  };

  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers[path] ?? [], isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({
      mutate: (input: unknown, handlers?: { onSuccess?: (data: unknown) => void }) => {
        if (path === "organization.createInvites") {
          calls.createInvites(input);
          handlers?.onSuccess?.([]);
          return;
        }
        handlers?.onSuccess?.(void 0);
      },
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    invalidate: vi.fn(),
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

vi.mock("../../../behavior/use-public-env", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("the invite drawer", () => {
  describe("given it is open for an organization", () => {
    /** @scenario Inviting through the drawer preserves organization and team scope */
    it("creates the invite against that organization and closes", async () => {
      const host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
      renderWithOrganizationHost(<InviteMemberDrawer open={true} />, host);

      await userEvent.type(
        screen.getByPlaceholderText("alice@example.com, bob@example.com"),
        "new@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: /send invites/i }));

      await waitFor(() => expect(calls.createInvites).toHaveBeenCalled());
      expect(calls.createInvites.mock.calls[0]?.[0]).toMatchObject({
        organizationId: "org-1",
        invites: [expect.objectContaining({ email: "new@acme.com" })],
      });
      await waitFor(() => expect(host.overlays).toContainEqual({ name: null }));
    });
  });
});
