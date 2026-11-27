/**
 * @vitest-environment jsdom
 *
 * Profile screen: composes the five bands over the host port.
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
    useUtils: () => ({
      auth: { browserSessions: { invalidate: () => Promise.resolve() } },
      digest: { getMyPreference: { invalidate: () => Promise.resolve() } },
    }),
    digest: {
      getMyPreference: { useQuery: () => ({ data: { subscribed: true } }) },
      setMyPreference: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }),
      },
    },
    routingPolicy: { personalContext: { useQuery: () => ({ error: null, isFetching: false }) } },
    identity: { myIdentifiers: { useQuery: () => ({ data: [] }) } },
    auth: {
      myAddressConfirmation: { useQuery: () => ({ data: undefined }) },
      browserSessions: { useQuery: () => ({ data: [], isLoading: false }) },
      endBrowserSession: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve({ ended: 0 }), isPending: false }),
      },
    },
    user: {
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

vi.mock("../../../../behavior/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) =>
    image?.startsWith("/api/user-avatar/") ? null : (image ?? null),
}));

afterEach(() => cleanup());

describe("given a signed-in reader", () => {
  describe("when the profile page renders", () => {
    /** @scenario "The profile shows my email preferences after my keys" */
    it("composes the five bands in order", () => {
      const host = fakePersonalWorkspaceHost();
      renderWithPersonalWorkspaceHost(<ProfileScreen />, { host });

      expect(screen.getByTestId("profile-details-section")).toBeTruthy();
      expect(screen.getByTestId("sign-in-methods-summary")).toBeTruthy();
      expect(screen.getByTestId("browser-sessions-settings-section")).toBeTruthy();
      expect(screen.getByTestId("personal-api-keys-summary")).toBeTruthy();
      const keys = screen.getByTestId("personal-api-keys-summary");
      const email = screen.getByTestId("email-preferences-settings-section");
      expect(keys.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
