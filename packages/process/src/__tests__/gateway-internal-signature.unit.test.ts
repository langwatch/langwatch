import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_TIMESTAMP_HEADER,
  gatewayInternalSignature,
  gatewayInternalSignatureHeaders,
} from "../gateway-internal-signature.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("gatewayInternalSignatureHeaders", () => {
  it("signs method, path, unix seconds and the body hash, each on its own line", () => {
    const headers = gatewayInternalSignatureHeaders({
      secret: "s3cr3t",
      method: "POST",
      path: "/internal/transform",
      body: '{"ok":true}',
      nowMs: 1_700_000_000_999,
    });

    expect(headers[GATEWAY_TIMESTAMP_HEADER]).toBe("1700000000");
    expect(headers[GATEWAY_SIGNATURE_HEADER]).toBe(
      createHmac("sha256", "s3cr3t")
        .update(`POST\n/internal/transform\n1700000000\n${sha256('{"ok":true}')}`)
        .digest("hex"),
    );
  });

  it("signs a GET over an empty body", () => {
    const headers = gatewayInternalSignatureHeaders({
      secret: "s3cr3t",
      method: "GET",
      path: "/internal/control-plane",
      nowMs: 1_700_000_000_000,
    });

    expect(headers[GATEWAY_SIGNATURE_HEADER]).toBe(
      createHmac("sha256", "s3cr3t")
        .update(`GET\n/internal/control-plane\n1700000000\n${sha256("")}`)
        .digest("hex"),
    );
  });

  it("gives a verifier the signature the headers carry, at the presented timestamp", () => {
    const headers = gatewayInternalSignatureHeaders({
      secret: "s3cr3t",
      method: "POST",
      path: "/api/internal/gateway/spend-commands",
      body: "{}",
      nowMs: 1_700_000_000_000,
    });

    expect(
      gatewayInternalSignature({
        secret: "s3cr3t",
        method: "POST",
        path: "/api/internal/gateway/spend-commands",
        timestamp: headers[GATEWAY_TIMESTAMP_HEADER] ?? "",
        body: "{}",
      }),
    ).toBe(headers[GATEWAY_SIGNATURE_HEADER]);
  });
});
