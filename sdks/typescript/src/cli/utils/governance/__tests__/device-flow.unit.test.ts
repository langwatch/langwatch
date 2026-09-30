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
    // Pre-f9fcc3927 server response shape (no `kind` field) is normalised
    // to a discriminated `device_session` result by the runtime.
    expect(r.kind).toBe("device_session");
    if (r.kind !== "device_session") throw new Error("unreachable");
    expect(r.access_token).toBe("at");
    expect(r.user.email).toBe("j@miro.com");
  });

  it("normalises legacy un-kinded device-session responses", async () => {
    // Pre-f9fcc3927 servers returned the bare device-session payload
    // without a `kind` discriminator. exchange() must add it so callers
    // can always switch on the union without runtime surprises.
    const body = {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      user: { id: "u", email: "j@x", name: "J" },
      organization: { id: "o", slug: "x", name: "X" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const r = await exchange({ baseUrl: url, fetchImpl }, "DC");
    expect(r.kind).toBe("device_session");
  });

  it("returns api_key kind for project_api_key credential type", async () => {
    const body = {
      kind: "api_key",
      api_key: "sk-lw-live-x",
      project: { id: "p_1", slug: "acme-prod", name: "Acme Prod" },
      user: { id: "u_1", email: "j@miro.com", name: "Jane" },
      organization: { id: "o_1", slug: "miro", name: "Miro" },
      endpoint: "http://x",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const r = await exchange({ baseUrl: url, fetchImpl }, "DC");
    expect(r.kind).toBe("api_key");
    if (r.kind !== "api_key") throw new Error("unreachable");
    expect(r.api_key).toBe("sk-lw-live-x");
    expect(r.project.slug).toBe("acme-prod");
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

  it("attaches client_info (hostname, uname, platform) to the exchange POST body", async () => {
    // Drives the /me/devices device-label fix (Ariana QA): without
    // client_info on /exchange, every CLI session falls back to
    // "Unknown device" in the inventory, blocking selective revoke
    // for multi-device users.
    const body = {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      user: { id: "u_1", email: "j@miro.com", name: "Jane" },
      organization: { id: "o_1", slug: "miro", name: "Miro" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    await exchange({ baseUrl: url, fetchImpl }, "DC");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const rawBody = init?.body;
    const sent = JSON.parse(
      typeof rawBody === "string" ? rawBody : "{}",
    ) as {
      device_code: string;
      client_info?: {
        hostname?: string;
        uname?: string;
        platform?: string;
      };
    };
    expect(sent.device_code).toBe("DC");
    expect(sent.client_info).toBeDefined();
    expect(sent.client_info?.platform).toBe(process.platform);
    expect(typeof sent.client_info?.hostname).toBe("string");
    expect(typeof sent.client_info?.uname).toBe("string");
  });
});

describe("pollUntilDone", () => {
  const deviceCode = {
    device_code: "DC",
    user_code: "u",
    verification_uri: "http://x/cli/auth",
    expires_in: 60,
    interval: 0.05,
  } as any;

  const sessionBody = {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    user: { id: "u", email: "j@x", name: "J" },
    organization: { id: "o", slug: "x", name: "X" },
  };

  /** An approval stream that emits one settle frame and stays open. */
  const approvalFrame = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"status":"approved"}\n\n'),
          );
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

  /**
   * A fetch that answers /exchange from `exchanges` in order and gives the
   * approval stream whatever `approval` returns. Counts only the polls: the
   * stream is an accelerator, not part of the poll contract.
   */
  function routedFetch({
    exchanges,
    approval = () => emptyResponse(404),
  }: {
    exchanges: Array<() => Response>;
    approval?: () => Response;
  }) {
    const polls: string[] = [];
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/device-approval")) {
        return Promise.resolve(approval());
      }
      polls.push(String(url));
      const next =
        exchanges[polls.length - 1] ?? exchanges[exchanges.length - 1];
      return Promise.resolve(next!());
    });
    return { fetchImpl, polls };
  }

  it("retries on pending, returns on success", async () => {
    const { fetchImpl, polls } = routedFetch({
      exchanges: [
        () => emptyResponse(428),
        () => jsonResponse(200, sessionBody),
      ],
    });
    const r = await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      deviceCode,
    );
    expect(r.kind).toBe("device_session");
    if (r.kind !== "device_session") throw new Error("unreachable");
    expect(r.access_token).toBe("at");
    expect(polls).toHaveLength(2);
  });

  /** @scenario "The CLI asks once before it starts waiting" */
  it("polls before the first wait", async () => {
    const { fetchImpl, polls } = routedFetch({
      exchanges: [() => jsonResponse(200, sessionBody)],
    });

    const started = Date.now();
    await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      { ...deviceCode, interval: 30 },
    );

    expect(polls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  /** @scenario "The approval stream cuts the wait short" */
  it("polls as soon as the approval stream emits", async () => {
    const { fetchImpl, polls } = routedFetch({
      exchanges: [
        () => emptyResponse(428),
        () => jsonResponse(200, sessionBody),
      ],
      approval: approvalFrame,
    });

    const started = Date.now();
    const r = await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      { ...deviceCode, interval: 30 },
    );

    expect(r.kind).toBe("device_session");
    expect(polls).toHaveLength(2);
    // Two polls at a 30s interval, finished in a fraction of one of them.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  /** @scenario "A server without the approval stream still logs in" */
  it("falls back to the interval when the stream is unavailable", async () => {
    const { fetchImpl, polls } = routedFetch({
      exchanges: [
        () => emptyResponse(428),
        () => jsonResponse(200, sessionBody),
      ],
      approval: () => emptyResponse(404),
    });

    const started = Date.now();
    await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      { ...deviceCode, interval: 0.2 },
    );

    expect(polls).toHaveLength(2);
    // The second poll waited the interval out rather than firing at once.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  /** @scenario "An approval that lands during a poll still cuts the next wait short" */
  it("polls at once when the frame landed while the previous poll was in flight", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    // Held in an object so the stream's `start` can hand the emitter back out.
    const frame: { emit: (() => void) | null } = { emit: null };
    const approval = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            frame.emit = () =>
              controller.enqueue(
                new TextEncoder().encode('data: {"status":"approved"}\n\n'),
              );
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );

    const pollTimes: number[] = [];
    let firstPollReturnedAt = 0;
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/device-approval")) return approval();
      pollTimes.push(Date.now());
      if (pollTimes.length > 2) return jsonResponse(200, sessionBody);
      if (pollTimes.length === 1) {
        // The browser settles the code while this poll is still in flight,
        // the window in which the wakeup has no wait to cut short yet.
        for (let i = 0; i < 50 && !frame.emit; i++) await tick();
        frame.emit?.();
        for (let i = 0; i < 50; i++) await tick();
        firstPollReturnedAt = Date.now();
      }
      return emptyResponse(428);
    });

    const r = await pollUntilDone(
      { baseUrl: "http://x", fetchImpl },
      { ...deviceCode, interval: 0.2 },
    );

    expect(r.kind).toBe("device_session");
    expect(pollTimes).toHaveLength(3);
    // The frame is what sends the second poll out, so it does not wait.
    expect(pollTimes[1]! - firstPollReturnedAt).toBeLessThan(150);
    // And it is spent by that poll: the third one waits the interval again.
    expect(pollTimes[2]! - pollTimes[1]!).toBeGreaterThanOrEqual(150);
  });

  it("propagates denied without retrying further", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(410));
    await expect(
      pollUntilDone({ baseUrl: "http://x", fetchImpl }, deviceCode),
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
