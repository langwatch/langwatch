/**
 * @vitest-environment jsdom
 * @see specs/model-providers/codex-account-provider.feature
 */
import { CodexAuthError } from "@langwatch/model-provider-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn();
const poll = vi.fn();

vi.mock("../../../behavior/model-provider-api.ts", () => {
  const mutation = (mutateAsync: (...args: unknown[]) => unknown) => ({
    useMutation: () => ({ mutateAsync, mutate: vi.fn(), isPending: false }),
  });
  const modelProvider = {
    codexStatus: {
      useQuery: () => ({
        data: { connected: true, providerId: "mp_codex", plan: "pro" },
        isLoading: false,
      }),
    },
    codexSignInStart: mutation((...args) => start(...args)),
    codexSignInPoll: mutation((...args) => poll(...args)),
    delete: mutation(vi.fn()),
  };
  const invalidate = () => Promise.resolve();
  const useUtils = () => ({ modelProvider: { invalidate } });
  return { api: { useUtils, modelProvider }, modelProviderApi: { useUtils, modelProvider } };
});

import { renderWithModelProviderHost } from "../../../testing.tsx";
import { CodexSignIn } from "../codex-sign-in.tsx";

describe("<CodexSignIn /> re-authenticating a connected Codex account", () => {
  beforeEach(() => {
    start.mockReset().mockResolvedValue({
      userCode: "ABCD-1234",
      deviceAuthId: "dev-1",
      verificationUrl: "https://issuer.test/codex/device",
      intervalSeconds: 0,
    });
    poll.mockReset();
  });

  afterEach(() => cleanup());

  describe("when the device code expires before it is approved", () => {
    it("says the code expired and offers to start again, instead of silently showing Connected", async () => {
      poll.mockRejectedValue(
        new CodexAuthError("sign_in_expired", "the sign-in code expired before it was approved"),
      );
      const user = userEvent.setup();
      renderWithModelProviderHost(
        <CodexSignIn projectId="proj-1" scopes={[]} setAsCodingDefaults={false} />,
      );

      await user.click(screen.getByRole("button", { name: /Re-authenticate/ }));

      expect(await screen.findByText(/The sign-in code expired/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Start sign-in again/ })).toBeInTheDocument();
      expect(screen.queryByText(/codex_auth_failed/)).not.toBeInTheDocument();
    });
  });

  describe("when the drawer edits a stored Codex row", () => {
    it("names that row on the poll, so the sign-in updates it instead of adding one", async () => {
      poll.mockResolvedValue({ status: "complete", email: "dev@example.com", plan: "pro" });
      const user = userEvent.setup();
      renderWithModelProviderHost(
        <CodexSignIn
          projectId="proj-1"
          modelProviderId="mp_codex"
          scopes={[]}
          setAsCodingDefaults={false}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Re-authenticate/ }));

      await vi.waitFor(() =>
        expect(poll).toHaveBeenCalledWith(expect.objectContaining({ modelProviderId: "mp_codex" })),
      );
    });
  });

  describe("when the sign-in fails for another reason", () => {
    it("shows the registry's words and keeps the Re-authenticate action", async () => {
      poll.mockRejectedValue(new CodexAuthError("http", "HTTP 503: unavailable"));
      const user = userEvent.setup();
      renderWithModelProviderHost(
        <CodexSignIn projectId="proj-1" scopes={[]} setAsCodingDefaults={false} />,
      );

      await user.click(screen.getByRole("button", { name: /Re-authenticate/ }));

      expect(await screen.findByText(/OpenAI sign-in didn't go through/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Re-authenticate/ })).toBeInTheDocument();
    });
  });
});
