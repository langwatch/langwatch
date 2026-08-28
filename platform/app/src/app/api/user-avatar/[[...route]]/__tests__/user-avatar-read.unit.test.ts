import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authenticated: true }));
const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("~/app/api/middleware/app-context", () => {
  const app = { userAvatarObjects: { getById: mocks.getById } };
  return {
    appContextMiddleware: async (
      context: {
        app?: unknown;
      },
      next: () => Promise<void>,
    ) => {
      Object.defineProperty(context, "app", { configurable: true, value: app });
      await next();
    },
  };
});

vi.mock("~/app/api/middleware/dual-auth", () => ({
  dualAuth: async (
    context: {
      json: (value: unknown, status: number) => Response;
      set: (key: "userId", value: string) => void;
    },
    next: () => Promise<void>,
  ) => {
    if (!state.authenticated) return context.json({ error: "unauthenticated" }, 401);
    context.set("userId", "user_1");
    await next();
  },
}));

vi.mock("~/server/rateLimit", () => ({ rateLimit: mocks.rateLimit }));

import { app } from "../app";

function availableAvatar(input?: { purpose?: string; ownerKind?: string; bytes?: Uint8Array }) {
  const bytes = input?.bytes ?? new Uint8Array([0x61, 0x76, 0x61, 0x74, 0x61, 0x72]);
  return {
    status: "available" as const,
    metadata: {
      byteLength: bytes.byteLength,
      mediaType: "image/png",
      purpose: input?.purpose ?? "user_avatar",
      ownerKind: input?.ownerKind ?? "user",
    },
    stream: Readable.from([Buffer.from(bytes)]),
  };
}

describe("user avatar read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authenticated = true;
    mocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 239,
      resetAt: Date.now() + 60_000,
    });
  });

  it("requires an authenticated caller before it reads an avatar", async () => {
    state.authenticated = false;

    const response = await app.request("/api/user-avatar/project_1/avatar_1");

    expect(response.status).toBe(401);
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("streams GET bytes and retains the deployed delivery headers", async () => {
    const bytes = new Uint8Array([0, 255, 3, 4]);
    mocks.getById.mockResolvedValueOnce(availableAvatar({ bytes }));

    const response = await app.request("/api/user-avatar/project_1/avatar_1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.getById).toHaveBeenCalledWith({ projectId: "project_1", id: "avatar_1" });
  });

  it("keeps HEAD metadata-only with the deployed delivery headers", async () => {
    const source = Readable.from([Buffer.from("avatar")]);
    mocks.getById.mockResolvedValueOnce({
      status: "available",
      metadata: {
        byteLength: 6,
        mediaType: "image/png",
        purpose: "user_avatar",
        ownerKind: "user",
      },
      stream: source,
    });

    const response = await app.request("/api/user-avatar/project_1/avatar_1", {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(await response.text()).toBe("");
  });

  it("returns Retry-After when the caller exhausts the avatar read budget", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 3_001 });

    const response = await app.request("/api/user-avatar/project_1/avatar_1");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-avatar purpose", availableAvatar({ purpose: "scenario_event" }), "not_found"],
    ["a non-user owner", availableAvatar({ ownerKind: "scenario_run" }), "not_found"],
    [
      "an avatar whose bytes are missing",
      {
        status: "missing" as const,
        metadata: {
          byteLength: 6,
          mediaType: "image/png",
          purpose: "user_avatar",
          ownerKind: "user",
        },
      },
      "missing",
    ],
  ])("returns 404 for %s", async (_reason, result, status) => {
    mocks.getById.mockResolvedValueOnce(result);

    const response = await app.request("/api/user-avatar/project_1/avatar_1");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ status });
  });

  it("maps provider and storage failures to the established 502 response", async () => {
    mocks.getById.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await app.request("/api/user-avatar/project_1/avatar_1");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "avatar temporarily unavailable" });
  });
});
