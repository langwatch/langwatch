import { createHash, createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OttlGatewayUnavailableError } from "../ottl-transform.channel.ts";
import { HttpOttlTransformChannel } from "../http/http.ottl-transform.channel.ts";

const BASE_URL = "https://gateway.internal.test";
const SECRET = "shared-secret";
const NOW_MS = 1_700_000_000_000;

function expectedSignature(method: string, path: string, timestamp: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  return createHmac("sha256", SECRET).update(canonical).digest("hex");
}

describe("HttpOttlTransformChannel", () => {
  let request: Mock<typeof fetch>;

  beforeEach(() => {
    request = vi.fn<typeof fetch>();
  });

  function channel(overrides: { baseUrl?: string | null; secret?: string | null } = {}) {
    return HttpOttlTransformChannel.create({
      baseUrl: "baseUrl" in overrides ? overrides.baseUrl : BASE_URL,
      secret: "secret" in overrides ? overrides.secret : SECRET,
      request,
      now: () => NOW_MS,
    });
  }

  describe("given a configured base URL and secret", () => {
    describe("when validate is called", () => {
      it("signs and posts the exact request shape the gateway expects", async () => {
        request.mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );

        const result = await channel().validate(["set(foo, 1)"]);

        expect(result).toEqual({ status: "valid" });
        expect(request).toHaveBeenCalledTimes(1);
        const [url, init] = request.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${BASE_URL}/internal/validate-ottl`);
        expect(init.method).toBe("POST");
        expect(init.body).toBe(JSON.stringify({ statements: ["set(foo, 1)"] }));

        const timestamp = Math.floor(NOW_MS / 1_000).toString();
        const headers = init.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers["X-LangWatch-Gateway-Timestamp"]).toBe(timestamp);
        expect(headers["X-LangWatch-Gateway-Node"]).toBe("control-plane");
        expect(headers["X-LangWatch-Gateway-Signature"]).toBe(
          expectedSignature("POST", "/internal/validate-ottl", timestamp, init.body as string),
        );
      });

      /** @scenario "Admin pastes an OTTL statement with a syntax error" */
      it("reports each invalid statement the gateway names", async () => {
        request.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: false,
              errors: [{ statement_index: 0, line: 1, col: 4, message: "unknown function" }],
            }),
            { status: 200 },
          ),
        );

        const result = await channel().validate(["bogus(foo)"]);

        expect(result).toEqual({
          status: "invalid",
          errors: [{ statementIndex: 0, line: 1, col: 4, message: "unknown function" }],
        });
      });

      describe("when the gateway route does not exist yet", () => {
        it("defers rather than treating a 404 as a failure", async () => {
          request.mockResolvedValueOnce(new Response("not found", { status: 404 }));

          const result = await channel().validate(["set(foo, 1)"]);

          expect(result).toEqual({ status: "deferred", reason: "endpoint_unavailable" });
        });
      });

      describe("when no base URL or secret is configured", () => {
        it("defers rather than throwing", async () => {
          const result = await channel({ baseUrl: null, secret: null }).validate(["set(foo, 1)"]);

          expect(result).toEqual({ status: "deferred", reason: "gateway_unconfigured" });
          expect(request).not.toHaveBeenCalled();
        });
      });
    });

    describe("when transform is called", () => {
      /** @scenario "Cost extraction via OTTL transform on a Claude Code payload" */
      it("posts the parsed input and reads payload_b64 back", async () => {
        request.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, payload_b64: "cGF5bG9hZA==", encoding: "json" }),
            { status: 200 },
          ),
        );

        const result = await channel().transform({
          sourceId: "source-1",
          kind: "log",
          encoding: "json",
          payloadB64: "cGF5bG9hZA==",
          statements: ["set(foo, 1)"],
        });

        expect(result).toEqual({ ok: true, payloadB64: "cGF5bG9hZA==", encoding: "json" });
        const [url, init] = request.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${BASE_URL}/internal/transform`);
        expect(JSON.parse(init.body as string)).toEqual({
          source_id: "source-1",
          kind: "log",
          encoding: "json",
          payload_b64: "cGF5bG9hZA==",
          payload_proto_b64: "cGF5bG9hZA==",
          statements: ["set(foo, 1)"],
        });
      });

      describe("when no base URL or secret is configured", () => {
        it("throws instead of deferring, unlike validate", async () => {
          await expect(
            channel({ baseUrl: null, secret: null }).transform({
              sourceId: "source-1",
              kind: "log",
              encoding: "json",
              payloadB64: "cGF5bG9hZA==",
              statements: [],
            }),
          ).rejects.toBeInstanceOf(OttlGatewayUnavailableError);
        });
      });
    });
  });
});
