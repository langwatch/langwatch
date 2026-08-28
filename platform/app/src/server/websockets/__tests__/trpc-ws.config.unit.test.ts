import { describe, expect, it } from "vitest";
import { resolveTrpcWebSocketRuntimeConfig } from "../trpc-ws.config";

describe("resolveTrpcWebSocketRuntimeConfig", () => {
  it("normalizes the configured public URL to its exact origin", () => {
    expect(
      resolveTrpcWebSocketRuntimeConfig({ NEXTAUTH_URL: "https://app.langwatch.ai/auth/sign-in" }),
    ).toEqual({ allowedOrigins: ["https://app.langwatch.ai"] });
  });

  it.each([undefined, "", "not a URL"])("fails closed for %j", (NEXTAUTH_URL) => {
    expect(resolveTrpcWebSocketRuntimeConfig({ NEXTAUTH_URL })).toEqual({ allowedOrigins: [] });
  });
});
