/**
 * Real-Chromium audit log: a row written by no user names the system as its actor.
 * Spec: specs/audit-log/audit-log.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import AuditLogScreen from "../audit-log.screen.tsx";

const { state } = vi.hoisted(() => ({
  state: { auditLogs: [] as Record<string, unknown>[] },
}));

vi.mock("../../../../behavior/user/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

vi.mock("../../../../behavior/organization-api.ts", () => ({
  organizationApi: {
    useUtils: () => ({ organization: { getAuditLogs: { fetch: vi.fn() } } }),
    organization: {
      getAuditLogs: {
        useQuery: () => ({
          data: { auditLogs: state.auditLogs, totalCount: state.auditLogs.length },
          isLoading: false,
        }),
      },
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: {
            members: [
              { userId: "u-1", user: { id: "u-1", name: "Alice", email: "alice@example.com" } },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    createdAt: new Date("2026-03-04T09:30:00.000Z"),
    userId: "u-1",
    organizationId: "org-1",
    projectId: null,
    action: "apiKey.create",
    payload: null,
    ipAddress: null,
    userAgent: null,
    error: null,
    args: null,
    user: { id: "u-1", name: "Alice", email: "alice@example.com" },
    project: null,
    source: "platform",
    targetKind: null,
    targetId: null,
    before: null,
    after: null,
    actorUserId: null,
    actorUser: null,
    ...overrides,
  };
}

function enterpriseHost() {
  return new FakeOrganizationHost({ isEnterprise: true, isPlanLoading: false });
}

beforeEach(async () => {
  state.auditLogs = [auditRow()];
  await page.viewport(1280, 800);
});

afterEach(() => cleanup());

describe("given the audit log in a real browser", () => {
  describe("when a row was written by no user", () => {
    /** @scenario A row written by a system actor says so rather than naming nobody */
    it("names the system as the actor", async () => {
      state.auditLogs = [auditRow({ userId: null, user: null, action: "authz.grants.attach" })];
      renderWithOrganizationHost(<AuditLogScreen />, enterpriseHost());

      await waitFor(() => expect(screen.getByText("System")).toBeVisible());
      expect(screen.queryByText("User not found")).not.toBeInTheDocument();
    });
  });
});
