import { describe, expect, it } from "vitest";
import { AppGovernanceOttlGateway } from "../ottl-gateway.client";

describe("AppGovernanceOttlGateway", () => {
  it("defers validation when the gateway is not configured", async () => {
    const gateway = AppGovernanceOttlGateway.create({});

    await expect(gateway.validate(["set(attributes[\"x\"], \"y\")"])).resolves.toEqual(
      { status: "deferred", reason: "gateway_unconfigured" },
    );
  });

  it("signs validation requests and normalizes gateway errors", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const request: typeof fetch = async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(
        JSON.stringify({
          ok: false,
          errors: [{ statement_index: 2, line: 4, col: 7, message: "bad" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const gateway = AppGovernanceOttlGateway.create({
      baseUrl: "https://gateway.example/",
      secret: "secret",
      request,
      now: () => 1_700_000_000_000,
    });

    await expect(gateway.validate(["invalid"])).resolves.toEqual({
      status: "invalid",
      errors: [{ statementIndex: 2, line: 4, col: 7, message: "bad" }],
    });
    expect(observedUrl).toBe(
      "https://gateway.example/internal/validate-ottl",
    );
    expect(new Headers(observedInit?.headers).get("X-LangWatch-Gateway-Timestamp")).toBe(
      "1700000000",
    );
    expect(
      new Headers(observedInit?.headers).get("X-LangWatch-Gateway-Signature"),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the transformed payload using the requested encoding fallback", async () => {
    const request: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true, payload_b64: "bXV0YXRlZA==" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const gateway = AppGovernanceOttlGateway.create({
      baseUrl: "https://gateway.example",
      secret: "secret",
      request,
    });

    await expect(
      gateway.transform({
        sourceId: "source_1",
        kind: "log",
        encoding: "proto",
        payloadB64: "b3JpZ2luYWw=",
        statements: ["set(attributes[\"x\"], \"y\")"],
      }),
    ).resolves.toEqual({
      ok: true,
      payloadB64: "bXV0YXRlZA==",
      encoding: "proto",
    });
  });
});
