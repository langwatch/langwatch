import { describe, expect, it } from "vitest";

import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "../../routes/gateway-internal";

// Byte-level agreement fixture between the Go gateway signer
// (services/gateway/internal/auth/hmac_test.go) and the Hono verifier. The
// test vector is published in contract §4 and the Go repo; any change must
// be coordinated with both sides to keep the test passing.
const VECTOR = {
  secret: "shared-test-secret-32byteslong!!",
  method: "POST",
  path: "/api/internal/gateway/resolve-key",
  timestamp: "1734567890",
  body: '{"key_presented":"lw_vk_live_01HZX","gateway_node_id":"gw-a"}',
  bodySha256:
    "59f25745b66fbb0c7b3714572d20ffef741817b84b86093e4ac6af243af66816",
  signature:
    "4e4c8634b10a7ef719cf6d56b89b7f44a5ac7544c03d98ef132b79d36a1a6a1f",
};

describe("gateway HMAC signature", () => {
  describe("canonical string assembly", () => {
    it("includes method, path, timestamp, and sha256(body) on separate lines", () => {
      const canonical = buildGatewayCanonicalString(VECTOR);
      expect(canonical).toBe(
        `${VECTOR.method}\n${VECTOR.path}\n${VECTOR.timestamp}\n${VECTOR.bodySha256}`,
      );
    });
  });

  describe("signature computation", () => {
    it("matches the published canonical test vector byte-for-byte", () => {
      const canonical = buildGatewayCanonicalString(VECTOR);
      expect(computeGatewaySignature(VECTOR.secret, canonical)).toBe(
        VECTOR.signature,
      );
    });

    it("changes when the body is tampered", () => {
      const canonical = buildGatewayCanonicalString({
        ...VECTOR,
        body: VECTOR.body + " ",
      });
      expect(computeGatewaySignature(VECTOR.secret, canonical)).not.toBe(
        VECTOR.signature,
      );
    });

    it("changes when the timestamp drifts", () => {
      const canonical = buildGatewayCanonicalString({
        ...VECTOR,
        timestamp: "1734567891",
      });
      expect(computeGatewaySignature(VECTOR.secret, canonical)).not.toBe(
        VECTOR.signature,
      );
    });

    it("changes when the path differs by one byte", () => {
      const canonical = buildGatewayCanonicalString({
        ...VECTOR,
        path: VECTOR.path + "/",
      });
      expect(computeGatewaySignature(VECTOR.secret, canonical)).not.toBe(
        VECTOR.signature,
      );
    });
  });
});
