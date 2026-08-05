/**
 * Device login persists the personal project delivered by /exchange, so data
 * commands authenticate with zero env vars from the very first post-login
 * command, no lazy exchange needed. Older servers omit the field and the
 * config simply carries none.
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollUntilDone = vi.fn();
vi.mock("../device-flow", async () => {
  const actual =
    await vi.importActual<typeof import("../device-flow")>("../device-flow");
  return {
    ...actual,
    startDeviceCode: vi.fn(async () => ({
      device_code: "dc",
      user_code: "WDJB-MJHT",
      verification_uri: "https://app.langwatch.ai/cli/auth",
      expires_in: 600,
      interval: 5,
    })),
    pollUntilDone: (...args: unknown[]) => pollUntilDone(...args),
  };
});

vi.mock("../cli-api", () => ({
  getCliBootstrap: vi.fn(async () => null),
  listIngestionKeys: vi.fn(async () => []),
  extractLookupIdFromToken: vi.fn(() => undefined),
}));

vi.mock("../telemetry-refresh", () => ({
  refreshTelemetryWiringForLogin: vi.fn(async () => ({
    mintedAny: false,
    labels: [],
  })),
}));

vi.mock("../../spinner", () => ({
  createSpinner: vi.fn(() => {
    const spinner = {
      start: () => spinner,
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    };
    return spinner;
  }),
}));

const saveConfig = vi.fn();
vi.mock("../config", () => ({
  loadConfig: vi.fn(() => ({
    control_plane_url: "https://app.langwatch.ai",
    gateway_url: "https://gateway.langwatch.ai",
  })),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
}));

vi.mock("../../identityNotice", () => ({
  rememberProjectName: vi.fn(),
}));

import { loadConfig } from "../config";
import { runUnifiedLoginFlow } from "../login-flow";

const exchangeResult = (extra: Record<string, unknown> = {}) => ({
  kind: "device_session" as const,
  access_token: "lw_at_new",
  refresh_token: "lw_rt_new",
  expires_in: 3600,
  user: { id: "u1", email: "dev@example.com", name: "Dev" },
  organization: { id: "o1", name: "Acme", slug: "acme" },
  ...extra,
});

describe("runUnifiedLoginFlow (device session) personal-project persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LANGWATCH_BROWSER = "none";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.LANGWATCH_BROWSER;
    vi.restoreAllMocks();
  });

  /** @scenario device-login exchange delivers the personal project key and the CLI stores it */
  it("persists personal_project from the exchange response into the config", async () => {
    pollUntilDone.mockResolvedValue(
      exchangeResult({
        personal_project: {
          id: "proj_p",
          slug: "personal-dev",
          name: "Personal Workspace",
          api_key: "pkey_delivered",
        },
      }),
    );

    const cfg = await runUnifiedLoginFlow({ kind: "device_session" });

    expect(cfg.personal_project).toEqual({
      id: "proj_p",
      slug: "personal-dev",
      name: "Personal Workspace",
      api_key: "pkey_delivered",
      // The exchange proved liveness, so the revalidation clock is seeded now.
      validated_at: expect.any(Number),
    });
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        personal_project: expect.objectContaining({
          api_key: "pkey_delivered",
        }),
      }),
    );
  });

  it("leaves personal_project unset when an older server omits the field", async () => {
    pollUntilDone.mockResolvedValue(exchangeResult());

    const cfg = await runUnifiedLoginFlow({ kind: "device_session" });

    expect(cfg.personal_project).toBeUndefined();
  });

  it("clears the previous login's personal_project when the exchange omits the field", async () => {
    // Log in as a DIFFERENT user against an older server: the prior user's
    // cached key (with a fresh validation clock) must not survive into the
    // new session, or commands would authenticate as the prior user.
    vi.mocked(loadConfig).mockReturnValue({
      control_plane_url: "https://app.langwatch.ai",
      gateway_url: "https://gateway.langwatch.ai",
      personal_project: {
        id: "proj_prior",
        slug: "personal-prior",
        name: "Prior User Workspace",
        api_key: "pkey_prior_user",
        validated_at: Math.floor(Date.now() / 1000),
      },
    } as never);
    pollUntilDone.mockResolvedValue(exchangeResult());

    const cfg = await runUnifiedLoginFlow({ kind: "device_session" });

    expect(cfg.personal_project).toBeUndefined();
    expect(saveConfig).toHaveBeenCalledWith(
      expect.not.objectContaining({ personal_project: expect.anything() }),
    );
  });
});
