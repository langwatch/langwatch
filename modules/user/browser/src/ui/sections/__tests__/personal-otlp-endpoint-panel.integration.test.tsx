/**
 * @vitest-environment jsdom
 *
 * The personal OTLP panel: no key on the page; a personal access token is minted on a click.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { PersonalOtlpEndpointPanel } from "../personal-otlp-endpoint-panel.tsx";

const { hookInput, mint } = vi.hoisted(() => ({ hookInput: vi.fn(), mint: vi.fn() }));

vi.mock("@langwatch/api-key-client", () => ({
  useMintPersonalToken: (input: unknown) => {
    hookInput(input);
    const [token, setToken] = useState<string>();
    return {
      token,
      isMinting: false,
      scopeNote: "",
      mint: () => {
        mint();
        setToken("lw-pat-minted");
        return Promise.resolve("lw-pat-minted");
      },
    };
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
      expect(mint).toHaveBeenCalledOnce();
      expect(hookInput).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_1", projectId: "proj_me" }),
      );
    });
  });
});
