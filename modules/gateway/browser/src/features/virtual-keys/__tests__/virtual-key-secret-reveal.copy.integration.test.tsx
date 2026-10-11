/**
 * @vitest-environment jsdom
 * The show-once secret dialog's copy action and acknowledgement gate.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { VirtualKeySecretReveal } from "../ui/sections/virtual-key-secret-reveal.tsx";

const SECRET = "lw_vk_live_FAKEFIXTUREFAKEFIXTURE0123456789";

const renderReveal = ({
  onClose = () => undefined,
  secret = SECRET,
  keyName = "production-app",
} = {}) => {
  const host = fakeGatewayHost();
  const view = renderWithGatewayHost(
    <VirtualKeySecretReveal open onClose={onClose} keyName={keyName} secret={secret} />,
    { host },
  );
  return { host, ...view };
};

const copyButton = () => screen.getByRole("button", { name: "Copy secret" });

describe("given the virtual key secret dialog", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the user copies the masked secret", () => {
    it("writes the full secret, says so and shows the copied tick", async () => {
      const user = userEvent.setup();
      const { host } = renderReveal();
      await user.click(copyButton());

      await expect(navigator.clipboard.readText()).resolves.toBe(SECRET);
      expect(host.recording.successes).toEqual([
        expect.objectContaining({ title: "Secret copied" }),
      ]);
      expect(JSON.stringify(host.recording.successes)).not.toContain(SECRET);
      expect(screen.getByTestId("gateway-virtual-key-secret")).not.toHaveTextContent(SECRET);
    });

    it("writes the full secret after it is revealed too", async () => {
      const user = userEvent.setup();
      renderReveal();
      await user.click(screen.getByRole("button", { name: "Reveal secret" }));
      await user.click(copyButton());

      await expect(navigator.clipboard.readText()).resolves.toBe(SECRET);
    });

    it("does not tick the acknowledgement for the user", async () => {
      const user = userEvent.setup();
      renderReveal();
      await user.click(copyButton());

      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(screen.getByTestId("gateway-virtual-key-secret-close")).toBeDisabled();
    });
  });

  describe("when the clipboard refuses the write", () => {
    it("keeps the secret, says the copy failed and never claims a copy", async () => {
      const user = userEvent.setup();
      const { host } = renderReveal();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
      await user.click(copyButton());

      const failure = await screen.findByTestId("gateway-virtual-key-secret-copy-failed");
      expect(failure).toHaveTextContent("Couldn't copy to the clipboard.");
      expect(failure).not.toHaveTextContent(SECRET);
      expect(host.recording.successes).toEqual([]);
      expect(screen.getByTestId("gateway-virtual-key-secret-close")).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Reveal secret" }));
      expect(screen.getByTestId("gateway-virtual-key-secret")).toHaveTextContent(SECRET);
    });

    it("clears the failure once a retry lands", async () => {
      const user = userEvent.setup();
      const { host } = renderReveal();
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockRejectedValueOnce(new Error("denied"));
      await user.click(copyButton());
      await screen.findByTestId("gateway-virtual-key-secret-copy-failed");

      write.mockRestore();
      await user.click(copyButton());

      await waitFor(() =>
        expect(screen.queryByTestId("gateway-virtual-key-secret-copy-failed")).toBeNull(),
      );
      expect(host.recording.successes).toHaveLength(1);
    });
  });

  describe("when the browser has no clipboard", () => {
    it("says the copy failed instead of throwing", async () => {
      const user = userEvent.setup();
      const { host } = renderReveal();
      vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as never);
      await user.click(copyButton());

      expect(await screen.findByTestId("gateway-virtual-key-secret-copy-failed")).toBeVisible();
      expect(host.recording.successes).toEqual([]);
    });
  });

  describe("when the user copies twice, then closes and a new key opens", () => {
    it("starts the next secret with no copied or failed state", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { host } = renderReveal({ onClose });
      await user.click(copyButton());
      await user.click(copyButton());
      expect(host.recording.successes).toHaveLength(2);

      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByTestId("gateway-virtual-key-secret-close"));
      expect(onClose).toHaveBeenCalledTimes(1);

      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(screen.queryByTestId("gateway-virtual-key-secret-copy-failed")).toBeNull();
    });
  });
});
