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

  describe("when the reader copies from the panel", () => {
    async function mintToken() {
      const user = userEvent.setup();
      const host = fakePersonalWorkspaceHost();
      renderWithPersonalWorkspaceHost(
        <PersonalOtlpEndpointPanel organizationId="org_1" projectId="proj_me" />,
        { host },
      );
      await user.click(screen.getByRole("button", { name: "Create a personal access token" }));
      await screen.findByText(/Bearer lw-pat-minted/);
      return { user, host };
    }

    it("offers no copy of the snippet while it still holds the placeholder", () => {
      renderWithPersonalWorkspaceHost(
        <PersonalOtlpEndpointPanel organizationId="org_1" projectId="proj_me" />,
        { host: fakePersonalWorkspaceHost() },
      );

      expect(screen.queryByRole("button", { name: "Copy .env" })).not.toBeInTheDocument();
    });

    it("writes the whole env block, token included, and says so afterwards", async () => {
      const { user, host } = await mintToken();

      await user.click(screen.getByRole("button", { name: "Copy .env" }));

      await waitFor(() =>
        expect(host.recording.successes).toEqual([
          expect.objectContaining({ title: ".env copied to clipboard" }),
        ]),
      );
      expect(await navigator.clipboard.readText()).toBe(
        [
          'export OTEL_EXPORTER_OTLP_ENDPOINT="https://app.langwatch.ai/api/otel"',
          'export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer lw-pat-minted"',
        ].join("\n"),
      );
    });

    it("never claims a copy the clipboard refused and leaves the value to copy by hand", async () => {
      const { user, host } = await mintToken();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

      await user.click(screen.getByRole("button", { name: "Copy .env" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the .env");
      expect(host.recording.successes).toEqual([]);
      expect(screen.getByText(/Bearer lw-pat-minted/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Copy" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the endpoint");
      expect(host.recording.successes).toEqual([]);
    });
  });
});
