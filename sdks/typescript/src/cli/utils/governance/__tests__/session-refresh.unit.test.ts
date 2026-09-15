import { describe, expect, it, vi } from "vitest";

import { DeviceFlowError } from "../device-flow";
import type { GovernanceConfig } from "../config";
import {
  canRefreshSession,
  isAccessTokenExpired,
  refreshSession,
  refreshSessionIfExpired,
} from "../session-refresh";

const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function baseConfig(over: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "lw_at_old",
    refresh_token: "lw_rt_old",
    expires_at: NOW_S + 3600,
    ...over,
  };
}

const freshPair = {
  access_token: "lw_at_new",
  refresh_token: "lw_rt_new",
  expires_in: 3600,
};

describe("isAccessTokenExpired", () => {
  it("is false well inside the window", () => {
    expect(isAccessTokenExpired(baseConfig(), NOW_MS)).toBe(false);
  });

  it("is true past the recorded expiry", () => {
    const cfg = baseConfig({ expires_at: NOW_S - 1 });
    expect(isAccessTokenExpired(cfg, NOW_MS)).toBe(true);
  });

  it("is true inside the skew, so the request does not race the expiry", () => {
    const cfg = baseConfig({ expires_at: NOW_S + 30 });
    expect(isAccessTokenExpired(cfg, NOW_MS)).toBe(true);
  });

  it("is false when nothing recorded an expiry, e.g. an api-key login", () => {
    const cfg = baseConfig({ expires_at: undefined });
    expect(isAccessTokenExpired(cfg, NOW_MS)).toBe(false);
  });
});

describe("canRefreshSession", () => {
  it("needs a refresh token", () => {
    expect(canRefreshSession(baseConfig())).toBe(true);
    expect(canRefreshSession(baseConfig({ refresh_token: undefined }))).toBe(false);
  });
});

describe("refreshSession", () => {
  it("rotates the pair and persists it", async () => {
    const cfg = baseConfig();
    const saveImpl = vi.fn();
    const refreshImpl = vi.fn(async () => freshPair);

    const outcome = await refreshSession(cfg, {
      refreshImpl: refreshImpl as never,
      saveImpl,
      loadImpl: vi.fn() as never,
    });

    expect(outcome.status).toBe("refreshed");
    expect(refreshImpl).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://app.example.com" }),
      "lw_rt_old",
    );
    expect(cfg.access_token).toBe("lw_at_new");
    expect(cfg.refresh_token).toBe("lw_rt_new");
    expect(cfg.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(saveImpl).toHaveBeenCalledOnce();
  });

  it("reports unavailable with no refresh token to spend", async () => {
    const refreshImpl = vi.fn();
    const outcome = await refreshSession(baseConfig({ refresh_token: undefined }), {
      refreshImpl: refreshImpl as never,
    });

    expect(outcome.status).toBe("unavailable");
    expect(refreshImpl).not.toHaveBeenCalled();
  });

  it("reports rejected when the server says the token is gone", async () => {
    const cfg = baseConfig();
    const outcome = await refreshSession(cfg, {
      refreshImpl: (async () => {
        throw new DeviceFlowError("unauthorized", "session revoked");
      }) as never,
      // Nothing newer on disk: the rejection is real.
      loadImpl: (() => baseConfig()) as never,
      saveImpl: vi.fn(),
    });

    expect(outcome.status).toBe("rejected");
    expect(cfg.access_token).toBe("lw_at_old");
  });

  it("a revoked session stays dead even when the config reloads", async () => {
    const refreshImpl = vi.fn(async () => {
      throw new DeviceFlowError("unauthorized", "session revoked");
    });
    const outcome = await refreshSession(baseConfig(), {
      refreshImpl: refreshImpl as never,
      loadImpl: (() => baseConfig({ refresh_token: "lw_rt_other" })) as never,
      saveImpl: vi.fn(),
    });

    expect(outcome.status).toBe("rejected");
    // Both the config's token and the newer on-disk one were tried, and
    // both were refused. No third attempt.
    expect(refreshImpl).toHaveBeenCalledTimes(2);
  });

  it("retries with the token a sibling process rotated in", async () => {
    const cfg = baseConfig();
    const refreshImpl = vi.fn(async (_opts: unknown, token: string) => {
      if (token === "lw_rt_old") {
        throw new DeviceFlowError("unauthorized", "already spent");
      }
      return freshPair;
    });

    const outcome = await refreshSession(cfg, {
      refreshImpl: refreshImpl as never,
      loadImpl: (() => baseConfig({ refresh_token: "lw_rt_sibling" })) as never,
      saveImpl: vi.fn(),
    });

    expect(outcome.status).toBe("refreshed");
    expect(refreshImpl).toHaveBeenNthCalledWith(2, expect.anything(), "lw_rt_sibling");
    expect(cfg.access_token).toBe("lw_at_new");
  });

  it("describes a non-Error rejection instead of reporting undefined", async () => {
    const outcome = await refreshSession(baseConfig(), {
      // A polyfilled fetch can reject with a bare string; the reason still
      // has to read as something when the wrapper prints it. Rejecting
      // through the mock keeps the non-Error value without a bare `throw`.
      refreshImpl: vi.fn().mockRejectedValue("socket hang up") as never,
      loadImpl: (() => baseConfig()) as never,
      saveImpl: vi.fn(),
    });

    expect(outcome).toMatchObject({
      status: "failed",
      message: "socket hang up",
    });
  });

  it("reports a network failure on the sibling-token retry, not a dead session", async () => {
    const refreshImpl = vi.fn(async (_opts: unknown, token: string) => {
      if (token === "lw_rt_old") {
        throw new DeviceFlowError("unauthorized", "already spent");
      }
      throw new Error("connect ECONNREFUSED");
    });

    const outcome = await refreshSession(baseConfig(), {
      refreshImpl: refreshImpl as never,
      loadImpl: (() => baseConfig({ refresh_token: "lw_rt_sibling" })) as never,
      saveImpl: vi.fn(),
    });

    // The retry died on the wire rather than being refused, so the wrapper
    // should talk about connectivity, not send the user back to login.
    expect(outcome.status).toBe("failed");
    expect(outcome).toMatchObject({ message: "connect ECONNREFUSED" });
  });

  it("reports a network failure separately, leaving the token in place", async () => {
    const cfg = baseConfig();
    const outcome = await refreshSession(cfg, {
      refreshImpl: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as never,
      loadImpl: vi.fn() as never,
      saveImpl: vi.fn(),
    });

    expect(outcome.status).toBe("failed");
    expect(cfg.access_token).toBe("lw_at_old");
  });

  it("still hands back a working token when the config cannot be written", async () => {
    const cfg = baseConfig();
    const outcome = await refreshSession(cfg, {
      refreshImpl: (async () => freshPair) as never,
      saveImpl: (() => {
        throw new Error("EROFS");
      }) as never,
      loadImpl: vi.fn() as never,
    });

    expect(outcome.status).toBe("refreshed");
    expect(cfg.access_token).toBe("lw_at_new");
  });
});

describe("refreshSessionIfExpired", () => {
  it("does nothing while the token is still good", async () => {
    const refreshImpl = vi.fn();
    const outcome = await refreshSessionIfExpired(baseConfig(), {
      refreshImpl: refreshImpl as never,
    });

    expect(outcome).toBeNull();
    expect(refreshImpl).not.toHaveBeenCalled();
  });

  it("refreshes once the recorded expiry has passed", async () => {
    const cfg = baseConfig({ expires_at: 1 });
    const outcome = await refreshSessionIfExpired(cfg, {
      refreshImpl: (async () => freshPair) as never,
      saveImpl: vi.fn(),
      loadImpl: vi.fn() as never,
    });

    expect(outcome?.status).toBe("refreshed");
    expect(cfg.access_token).toBe("lw_at_new");
  });
});
