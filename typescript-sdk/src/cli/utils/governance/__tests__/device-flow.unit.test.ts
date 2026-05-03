import { describe, it, expect, vi } from "vitest";
import {
  startDeviceCode,
  exchange,
  pollUntilDone,
  refresh,
  logout,
  DeviceFlowError,
} from "../device-flow";

/** Minimal Response shim for fetch mocks. */
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const emptyResponse = (status: number): Response =>
  new Response("", { status });

describe("startDeviceCode", () => {
  it("posts to /api/auth/cli/device-code and returns the spec shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        device_code: "DC_xxx",
        user_code: "ABCD-EFGH",
        verification_uri: "http://localhost:5660/cli/auth",
        verification_uri_complete: "http://localhost:5660/cli/auth?user_code=ABCD-EFGH",
        expires_in: 300,
        interval: 5,
      }),
    );
    const dc = await startDeviceCode({ baseUrl: "http://localhost:5660", fetchImpl });
    expect(dc.device_code).toBe("DC_xxx");
    expect(dc.user_code).toBe("ABCD-EFGH");
    expect(dc.verification_uri_complete).toContain("user_code=ABCD-EFGH");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:5660/api/auth/cli/device-code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Origin: "http://localhost:5660" }),
      }),
    );
  });

  it("defaults interval to 5 when server returns 0/missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        device_code: "DC",
        user_code: "X-Y",
        verification_uri: "http://x/cli/auth",
        expires_in: 600,
        interval: 0,
      }),
    );
    const dc = await startDeviceCode({ baseUrl: "http://x", fetchImpl });
    expect(dc.interval).toBe(5);
  });
});

describe("exchange", () => {
  const url = "http://x";

  it("returns the result on 200", async () => {
    const body = {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      user: { id: "u_1", email: "j@miro.com", name: "Jane" },
      organization: { id: "o_1", slug: "miro", name: "Miro" },
      default_personal_vk: { id: "vk_1", secret: "lw_vk_live_x", prefix: "lw_vk_live_x" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const r = await exchange({ baseUrl: url, fetchImpl }, "DC");
    expect(r.access_token).toBe("at");
    expect(r.user.email).toBe("j@miro.com");
  });

  for (const [status, kind] of [
    [428, "pending"],
    [410, "denied"],
    [408, "expired"],
    [429, "slow_down"],
  ] as const) {
    it(`maps ${status} to DeviceFlowError kind=${kind}`, async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(status));
      await expect(exchange({ baseUrl: url, fetchImpl }, "DC"))
        .rejects.toMatchObject({ name: "DeviceFlowError", kind });
    });
  }

  it("throws DeviceFlowError(other) on unexpected status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    await expect(exchange({ baseUrl: url, fetchImpl }, "DC"))
      .rejects.toMatchObject({ name: "DeviceFlowError", kind: "other" });
  });
});

describe("pollUntilDone", () => {
  it("retries on pending, returns on success", async () => {
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) return Promise.resolve(emptyResponse(428));
      return Promise.resolve(
        jsonResponse(200, {
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          user: { id: "u", email: "j@x", name: "J" },
          organization: { id: "o", slug: "x", name: "X" },
        }),
      );
    });
    const r = await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      { device_code: "DC", user_code: "u", verification_uri: "http://x/cli/auth", expires_in: 60, interval: 0.05 } as any,
    );
    expect(r.access_token).toBe("at");
    expect(calls).toBe(2);
  });

  it("propagates denied without retrying further", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(410));
    await expect(
      pollUntilDone(
        { baseUrl: "http://x", fetchImpl },
        { device_code: "DC", user_code: "u", verification_uri: "http://x/cli/auth", expires_in: 60, interval: 0.05 } as any,
      ),
    ).rejects.toMatchObject({ kind: "denied" });
  });
});

describe("refresh", () => {
  it("returns rotated tokens on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "at_new", refresh_token: "rt_new", expires_in: 3600 }),
    );
    const r = await refresh({ baseUrl: "http://x", fetchImpl }, "rt_old");
    expect(r.access_token).toBe("at_new");
  });

  it("throws DeviceFlowError(unauthorized) on 401 so the caller can wipe local state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(401));
    await expect(refresh({ baseUrl: "http://x", fetchImpl }, "rt_x"))
      .rejects.toMatchObject({ kind: "unauthorized" });
  });
});

describe("logout", () => {
  it("treats 200/401/404 as success (idempotent)", async () => {
    for (const status of [200, 401, 404]) {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(status));
      await expect(logout({ baseUrl: "http://x", fetchImpl }, "rt")).resolves.toBeUndefined();
    }
  });

  it("propagates other failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    await expect(logout({ baseUrl: "http://x", fetchImpl }, "rt"))
      .rejects.toBeInstanceOf(DeviceFlowError);
  });
});
