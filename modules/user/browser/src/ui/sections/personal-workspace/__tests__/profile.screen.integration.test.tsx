/**
 * @vitest-environment jsdom
 *
 * Profile screen: composes the four bands over the host port.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
} from "../../../../testing.tsx";
import ProfileScreen from "../profile.screen.tsx";

vi.mock("../../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    useUtils: () => ({ user: { browserSessions: { invalidate: () => Promise.resolve() } } }),
    identity: { myIdentifiers: { useQuery: () => ({ data: [] }) } },
    auth: { myAddressConfirmation: { useQuery: () => ({ data: undefined }) } },
    user: {
      browserSessions: { useQuery: () => ({ data: [], isLoading: false }) },
      endBrowserSession: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve({ ended: 0 }), isPending: false }),
      },
      getLinkedAccounts: { useQuery: () => ({ data: [] }) },
      hasPassword: { useQuery: () => ({ data: { hasPassword: true } }) },
      updateName: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      setAvatar: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      removeAvatar: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));

vi.mock("@langwatch/api-key-client", () => ({
  apiKeyClient: { apiKey: { list: { useQuery: () => ({ data: [] }) } } },
}));

vi.mock("../../../../behavior/user-api.ts", () => ({
  userApi: { user: { getAvatarUrl: { useQuery: () => ({ data: undefined }) } } },
}));

afterEach(() => cleanup());

describe("given a signed-in reader", () => {
  describe("when the profile page renders", () => {
    it("composes the four bands in order", () => {
      const host = fakePersonalWorkspaceHost();
      renderWithPersonalWorkspaceHost(<ProfileScreen />, { host });

      expect(screen.getByTestId("profile-details-section")).toBeTruthy();
      expect(screen.getByTestId("sign-in-methods-summary")).toBeTruthy();
      expect(screen.getByTestId("browser-sessions-settings-section")).toBeTruthy();
      expect(screen.getByTestId("personal-api-keys-summary")).toBeTruthy();
    });
  });
});
