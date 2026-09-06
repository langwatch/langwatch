/**
 * Which of Google's two doors a refusal names.
 *
 * Gemini is sold through two services and a key opens exactly one, so the same
 * refusal reason means opposite remediations: a key blocked on the Gemini API
 * probably wants the project/location pair filled in, and one blocked on Agent
 * Platform probably wants it cleared. The copy in `presentation.ts` branches on
 * `meta.googleDoor` to say which — and telling a customer to fill fields they
 * should be clearing sends them the wrong way with confidence.
 *
 * Nothing pinned which door reached that copy. These do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("../../../utils/ssrfProtection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/ssrfProtection")>()),
  ssrfSafeFetch: (...args: unknown[]) => mockFetch(...args),
}));

import { validateProviderApiKey } from "../providerValidation";

/** Google's answer when a key is aimed at the service it does not open. */
const serviceBlocked = () => ({
  ok: false,
  status: 403,
  text: async () =>
    JSON.stringify({
      error: { details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] },
    }),
});

const doorOf = (result: Awaited<ReturnType<typeof validateProviderApiKey>>) =>
  result.valid ? undefined : result.domainError.meta?.googleDoor;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(serviceBlocked());
});

describe("given a Gemini credential that names a project and location", () => {
  it("says the Agent Platform door refused it", async () => {
    const result = await validateProviderApiKey("gemini", {
      GEMINI_API_KEY: "AIza-key",
      GEMINI_PROJECT: "acme-123",
      GEMINI_LOCATION: "global",
    });

    expect(doorOf(result)).toBe("agent-platform");
  });
});

describe("given a Gemini credential with no project or location", () => {
  it("says the Gemini API door refused it", async () => {
    const result = await validateProviderApiKey("gemini", {
      GEMINI_API_KEY: "AIza-key",
    });

    expect(doorOf(result)).toBe("gemini-api");
  });

  it("treats half a pair as no pair, so the copy does not offer to clear it", async () => {
    // Half a pair cannot reach Agent Platform, so naming that door would tell
    // the customer to clear a field they have already half-filled.
    const result = await validateProviderApiKey("gemini", {
      GEMINI_API_KEY: "AIza-key",
      GEMINI_PROJECT: "acme-123",
    });

    expect(doorOf(result)).toBe("gemini-api");
  });
});

describe("given a legacy Agent Platform row from the fold window", () => {
  it("reads the door from the retired field names", async () => {
    const result = await validateProviderApiKey("google_agent_platform", {
      GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.Legacy",
      GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
      GOOGLE_AGENT_PLATFORM_LOCATION: "global",
    });

    expect(doorOf(result)).toBe("agent-platform");
  });
});

describe("given a provider with only one door", () => {
  it("names no door at all", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await validateProviderApiKey("openai", {
      OPENAI_API_KEY: "sk-key",
    });

    expect(doorOf(result)).toBeUndefined();
  });
});
