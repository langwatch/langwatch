/**
 * @vitest-environment jsdom
 *
 * The copy-paste usage example must name a model the key can actually serve.
 * A key bound to a self-hosted / custom provider that shows the OpenAI-only
 * `gpt-5-mini` 404s on the first call, so the create/reveal/detail surfaces
 * thread the key's eligible-provider model (in resolver-safe `vendor/model`
 * form) into this snippet. These tests pin that the passed model reaches the
 * rendered code and that `gpt-5-mini` is only the no-context fallback.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import { VirtualKeyUsageSnippet } from "../ui/sections/virtual-key-usage-snippet";

/** Where the snippet says to point an SDK, as a local deployment answers it. */
const host = fakeGatewayHost({
  deployment: {
    isSaas: false,
    appBaseUrl: "http://localhost:5560",
    gatewayBaseUrl: "http://localhost:5563",
  },
});

describe("given a VirtualKeyUsageSnippet", () => {
  afterEach(() => cleanup());

  describe("when a custom-provider model is passed", () => {
    /** @scenario Usage example defaults to a model the key can serve */
    it("embeds custom/<model> in the copy-paste example, not gpt-5-mini", async () => {
      const { container } = renderWithGatewayHost(
        <VirtualKeyUsageSnippet
          secret="vk-lw-testsecret"
          model="custom/Qwen2.5-0.5B-Instruct"
        />,
        { host },
      );

      await waitFor(() => {
        expect(container.textContent).toContain("custom/Qwen2.5-0.5B-Instruct");
      });
      expect(container.textContent).not.toContain("gpt-5-mini");
    });
  });

  describe("when no model is passed", () => {
    /** @scenario Usage example falls back to a safe placeholder when no provider is resolvable */
    it("falls back to the gpt-5-mini placeholder", async () => {
      const { container } = renderWithGatewayHost(
        <VirtualKeyUsageSnippet secret="vk-lw-testsecret" />,
        { host },
      );

      await waitFor(() => {
        expect(container.textContent).toContain("gpt-5-mini");
      });
    });
  });
});
