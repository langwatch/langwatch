import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { sendHttpDestination } from "../httpDestination";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));

const mockedFetch = vi.mocked(ssrfSafeFetch);

function fetchResolves(status: number, text: string) {
  mockedFetch.mockResolvedValue({
    status,
    text: async () => text,
  } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
}

const send = () =>
  sendHttpDestination({
    url: "https://example.com/hook",
    body: "{}",
    contextLabel: "test",
  });

afterEach(() => vi.clearAllMocks());

describe("sendHttpDestination", () => {
  describe("when the endpoint responds", () => {
    it("returns the status and body", async () => {
      fetchResolves(200, "ok-body");
      await expect(send()).resolves.toEqual({ status: 200, body: "ok-body" });
    });

    it("caps an oversized response body", async () => {
      fetchResolves(200, "x".repeat(100_000));
      const res = await send();
      expect(res.body.length).toBe(64 * 1024);
    });

    it("returns an empty snippet when the body can't be read", async () => {
      mockedFetch.mockResolvedValue({
        status: 200,
        text: async () => {
          throw new Error("stream consumed");
        },
      } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
      await expect(send()).resolves.toEqual({ status: 200, body: "" });
    });
  });

  describe("when the request fails at the transport", () => {
    it("throws retryable on a connection error", async () => {
      mockedFetch.mockRejectedValue(new Error("ECONNRESET"));
      const err = (await send().catch((e) => e)) as DispatchError;
      expect(err).toBeInstanceOf(DispatchError);
      expect(err.retryable).toBe(true);
    });

    it("throws terminal when the URL is SSRF-blocked", async () => {
      mockedFetch.mockRejectedValue(
        new Error("URL blocked: resolves to a private IP"),
      );
      const err = (await send().catch((e) => e)) as DispatchError;
      expect(err.retryable).toBe(false);
    });
  });
});
