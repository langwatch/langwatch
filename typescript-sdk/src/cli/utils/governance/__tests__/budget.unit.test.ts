import { describe, it, expect, vi } from "vitest";
import { checkBudget, renderBudgetExceeded } from "../budget";
import type { GovernanceConfig } from "../config";

const baseCfg = (token?: string): GovernanceConfig => ({
  gateway_url: "http://gw.example",
  control_plane_url: "http://app.example",
  access_token: token ?? "at_x",
});

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const status = (code: number, body?: unknown): Response =>
  new Response(body ? JSON.stringify(body) : "", {
    status: code,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });

describe("checkBudget", () => {
  it("returns null when not logged in (no probe call)", async () => {
    const fetchImpl = vi.fn();
    const res = await checkBudget({ ...baseCfg(""), access_token: undefined }, { fetchImpl });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on 200 — happy path, exec normally", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ ok: true }));
    const res = await checkBudget(baseCfg(), { fetchImpl });
    expect(res).toBeNull();
  });

  it("returns null on 404 — older self-hosted server graceful fallback", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(404));
    const res = await checkBudget(baseCfg(), { fetchImpl });
    expect(res).toBeNull();
  });

  it("returns null on network error — never block the user", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await checkBudget(baseCfg(), { fetchImpl });
    expect(res).toBeNull();
  });

  it("returns the spec budget_exceeded payload on 402", async () => {
    const payload = {
      type: "budget_exceeded",
      scope: "user",
      limit_usd: "500.00",
      spent_usd: "500.00",
      period: "month",
      request_increase_url: "http://app.example/me/budget/request?abc",
      admin_email: "platform-team@miro.com",
    };
    const fetchImpl = vi.fn().mockResolvedValue(status(402, { error: payload }));
    const res = await checkBudget(baseCfg(), { fetchImpl });
    expect(res).toEqual(payload);
  });

  it("returns null on 402 with malformed payload (graceful)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(402, { error: { type: "" } }));
    const res = await checkBudget(baseCfg(), { fetchImpl });
    expect(res).toBeNull();
  });

  it("sends Bearer token from cfg.access_token", async () => {
    let seen = "";
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen = headers.Authorization;
      return Promise.resolve(ok({ ok: true }));
    });
    await checkBudget(baseCfg("at_TOKEN"), { fetchImpl });
    expect(seen).toBe("Bearer at_TOKEN");
  });
});

describe("renderBudgetExceeded", () => {
  const baseEvent = {
    type: "budget_exceeded",
    scope: "user" as const,
    limit_usd: "500.00",
    spent_usd: "500.00",
    period: "month",
    request_increase_url: "http://app.example/me/budget/request",
    admin_email: "platform-team@miro.com",
  };

  it("renders the spec-canonical Screen-8 box character-for-character", () => {
    const out = renderBudgetExceeded(baseEvent);
    expect(out).toContain("⚠  Budget limit reached");
    expect(out).toContain("You've used $500.00 of your $500.00 monthly budget.");
    expect(out).toContain("To continue, ask your team admin to raise your limit.");
    expect(out).toContain("Admin: platform-team@miro.com");
    expect(out).toContain("Need urgent access? Run:");
    expect(out).toContain("langwatch request-increase");
  });

  it("defaults period to 'month' when empty", () => {
    const out = renderBudgetExceeded({ ...baseEvent, period: "" });
    expect(out).toContain("monthly budget");
  });

  it("omits Admin: line when admin_email is empty", () => {
    const out = renderBudgetExceeded({ ...baseEvent, admin_email: "" });
    expect(out).not.toContain("Admin:");
  });

  it("contains no ANSI escape sequences (pipe-safe)", () => {
    const out = renderBudgetExceeded(baseEvent);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\[/);
  });
});
