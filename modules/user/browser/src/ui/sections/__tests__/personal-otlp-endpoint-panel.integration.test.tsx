/**
 * @vitest-environment jsdom
 *
 * The personal OTLP panel: no key on the page; a personal access token is minted on a click.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { PersonalOtlpEndpointPanel } from "../personal-otlp-endpoint-panel.tsx";

const { mint } = vi.hoisted(() => ({ mint: vi.fn() }));

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    apiKey: {
      create: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, handlers: { onSuccess: (r: { token: string }) => void }) => {
            mint(input);
            handlers.onSuccess({ token: "lw-pat-minted" });
          },
        }),
      },
    },
  },
}));

afterEach(() => cleanup());

describe("given the personal workspace's OTLP panel", () => {
  describe("when it opens", () => {
    /** @scenario The personal OTLP panel offers a personal access token, shown once */
    it("shows the key placeholder and mints nothing", () => {
      renderWithPersonalWorkspaceHost(
        <PersonalOtlpEndpointPanel organizationId="org_1" projectId="proj_me" />,
        { host: fakePersonalWorkspaceHost() },
      );

      expect(screen.getByText(/Bearer <YOUR_LANGWATCH_API_KEY>/)).toBeInTheDocument();
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when the reader creates a personal access token", () => {
    /** @scenario The personal OTLP panel offers a personal access token, shown once */
    it("mints a personal key on the project and fills the snippet with the token", async () => {
      renderWithPersonalWorkspaceHost(
        <PersonalOtlpEndpointPanel organizationId="org_1" projectId="proj_me" />,
        { host: fakePersonalWorkspaceHost() },
      );

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Create a personal access token" }));

      await waitFor(() => expect(screen.getByText(/Bearer lw-pat-minted/)).toBeInTheDocument());
      expect(mint).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          keyType: "personal",
          permissionMode: "all",
          bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: "proj_me" }],
        }),
      );
    });
  });
});
