/**
 * @vitest-environment jsdom
 * The home page's card of people waiting to join.
 * @see specs/identity/domain-auto-join.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingJoinRequest } from "../../../model/pending-join-request.ts";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import { PendingJoinRequests } from "../pending-join-requests.tsx";

const waiting = vi.hoisted(() => ({ current: [] as PendingJoinRequest[] }));

vi.mock("../../../behavior/use-join-requests.ts", () => ({
  useJoinRequests: () => ({
    requests: waiting.current,
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

afterEach(cleanup);

const request = (id: string): PendingJoinRequest => ({
  joinRequestId: id,
  name: `Person ${id}`,
  domain: "acme.com",
  requestedAt: "2026-09-01T10:00:00.000Z",
  expiresAt: null,
});

describe("given people waiting to join", () => {
  describe("when an administrator opens the home page", () => {
    it("says how many are waiting and lets them answer", () => {
      waiting.current = [request("a"), request("b")];

      renderWithOrganizationHost(<PendingJoinRequests />, new FakeOrganizationHost());

      expect(screen.getByTestId("home-pending-join-requests")).toBeInTheDocument();
      expect(screen.getByText("2 people have asked to join your organization.")).toBeVisible();
      expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
    });

    it("uses the singular for one person", () => {
      waiting.current = [request("a")];

      renderWithOrganizationHost(<PendingJoinRequests />, new FakeOrganizationHost());

      expect(screen.getByText("One person has asked to join your organization.")).toBeVisible();
    });
  });

  describe("when nobody is waiting", () => {
    it("draws nothing", () => {
      waiting.current = [];

      renderWithOrganizationHost(<PendingJoinRequests />, new FakeOrganizationHost());

      expect(screen.queryByTestId("home-pending-join-requests")).toBeNull();
    });
  });

  describe("when the reader cannot manage the organization", () => {
    it("draws nothing, however many are waiting", () => {
      waiting.current = [request("a")];

      renderWithOrganizationHost(
        <PendingJoinRequests />,
        new FakeOrganizationHost({ grants: new Set(["organization:view"]) }),
      );

      expect(screen.queryByTestId("home-pending-join-requests")).toBeNull();
    });
  });
});
