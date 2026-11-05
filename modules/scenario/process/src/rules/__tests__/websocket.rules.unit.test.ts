import { describe, expect, it } from "vitest";

import { closeToPassOn, isSendableCloseCode } from "../websocket.rules.ts";

describe("isSendableCloseCode", () => {
  it("accepts the standard codes a close frame may carry and the application range", () => {
    for (const code of [1000, 1001, 1008, 1011, 1012, 3000, 4408, 4502, 4999]) {
      expect(isSendableCloseCode(code)).toBe(true);
    }
  });

  it("refuses reserved codes and codes that only describe a close", () => {
    for (const code of [999, 1004, 1005, 1006, 1015, 2000, 5000]) {
      expect(isSendableCloseCode(code)).toBe(false);
    }
  });
});

describe("closeToPassOn", () => {
  describe("when the code cannot be sent", () => {
    it("passes the fallback on instead", () => {
      expect(closeToPassOn({ code: 1006, reason: "", fallback: 4502 })).toEqual({
        code: 4502,
        reason: "",
      });
    });
  });

  describe("when the reason is longer than a close frame carries", () => {
    it("cuts it to 123 bytes", () => {
      const { reason } = closeToPassOn({ code: 1000, reason: "é".repeat(100), fallback: 1000 });
      expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123);
      expect(reason).toBe("é".repeat(61));
    });
  });
});
