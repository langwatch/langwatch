import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => {
  throw new Error("the browser-safe package root loaded OpenTelemetry");
});

describe("browser-safe package root", () => {
  it("loads without evaluating OpenTelemetry", async () => {
    const telemetry = await import("../index");

    expect(telemetry.createLogger).toBeTypeOf("function");
    expect(telemetry.logHttpRequest).toBeTypeOf("function");
  });
});
