import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { licensingConfig } from "../licensing.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "licensing", config: licensingConfig }],
    environment,
  }).licensing;

describe("licensing server configuration", () => {
  describe("given a deployment rotated the public key", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the rotated key", () => {
      expect(read({ LANGWATCH_LICENSE_PUBLIC_KEY: "rotated-key" }).publicKey).toBe("rotated-key");
    });
  });

  describe("given the key is exported blank", () => {
    /** @scenario "A blank identifier resolves to absent rather than to an empty filter" */
    it("falls back to the embedded key rather than refusing every licence", () => {
      expect(read({ LANGWATCH_LICENSE_PUBLIC_KEY: "  " }).publicKey).toBeUndefined();
      expect(read({}).publicKey).toBeUndefined();
    });
  });

  describe("the connect endpoints", () => {
    describe("given an https endpoint", () => {
      it("accepts it", () => {
        expect(
          read({ LANGWATCH_CONNECT_GATEWAY_ENDPOINT: "https://gateway.langwatch.ai" })
            .connectGatewayEndpoint,
        ).toBe("https://gateway.langwatch.ai");
      });
    });

    describe("given a plain http endpoint on a public host", () => {
      it("refuses it naming the variable", () => {
        expect(() =>
          read({ LANGWATCH_CONNECT_GATEWAY_ENDPOINT: "http://gateway.example.com" }),
        ).toThrow(/LANGWATCH_CONNECT_GATEWAY_ENDPOINT must use https/);
      });
    });

    describe("given a plain http endpoint on a loopback host", () => {
      it("accepts localhost and 127.0.0.1 with a port", () => {
        expect(
          read({ LANGWATCH_CONNECT_LICENSE_ENDPOINT: "http://localhost:5643" })
            .connectLicenseEndpoint,
        ).toBe("http://localhost:5643");
        expect(
          read({ LANGWATCH_CONNECT_LICENSE_ENDPOINT: "http://127.0.0.1:5643" })
            .connectLicenseEndpoint,
        ).toBe("http://127.0.0.1:5643");
      });
    });

    describe("given no value", () => {
      it("falls back to the hosted endpoints", () => {
        expect(read({}).connectGatewayEndpoint).toBe("https://gateway.langwatch.ai");
        expect(read({}).connectLicenseEndpoint).toBe("https://connect.langwatch.ai");
        expect(read({ LANGWATCH_CONNECT_GATEWAY_ENDPOINT: "" }).connectGatewayEndpoint).toBe(
          "https://gateway.langwatch.ai",
        );
      });
    });
  });
});
