import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithCliCredentialHolder, setResolvedApiKey } from "@/internal/credentialContext";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { listMonitorsCommand } from "../monitors/list";
import { listIngestionSources } from "../../utils/governance/cli-api";

vi.mock("../../utils/apiKey", () => ({ resolveCredentials: vi.fn() }));
vi.mock("../../utils/spinner", () => ({
  createSpinner: () => ({
    start() {
      return this;
    },
    succeed: vi.fn(),
  }),
}));

describe("CLI request attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when a command uses a direct HTTP transport", () => {
    /** @scenario The CLI declares itself on every request */
    it("identifies monitor requests alongside their authentication", async () => {
      const requests: Request[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json([]);
      };
      vi.stubGlobal("fetch", fetchImpl);

      await runWithCliCredentialHolder(async () => {
        setResolvedApiKey("sk-lw-test");
        await listMonitorsCommand();
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toContain("/api/monitors");
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk-lw-test");
      expect(requests[0]?.headers.get("x-langwatch-surface")).toBe("cli");
      expect(requests[0]?.headers.get("x-langwatch-sdk-language")).toBe("typescript");
      expect(requests[0]?.headers.get("x-langwatch-sdk-version")).toBe(LANGWATCH_SDK_VERSION);
    });

    /** @scenario The CLI declares itself on every request */
    it("identifies governance reads using device-session authentication", async () => {
      const requests: Request[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ sources: [] });
      };

      await listIngestionSources(
        {
          control_plane_url: "https://example.test",
          gateway_url: "https://gateway.example.test",
          access_token: "device-session",
        },
        { fetchImpl },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer device-session");
      expect(requests[0]?.headers.get("x-langwatch-surface")).toBe("cli");
      expect(requests[0]?.headers.get("x-langwatch-sdk-version")).toBe(LANGWATCH_SDK_VERSION);
    });
  });
});
