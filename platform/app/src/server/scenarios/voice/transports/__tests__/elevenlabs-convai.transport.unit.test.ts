import { describe, expect, it } from "vitest";
import {
  ELEVENLABS_CONNECT_REJECTED_PREFIX,
  wrapConnectRejection,
} from "../elevenlabs-convai.transport";

describe("wrapConnectRejection", () => {
  describe("when the underlying connect throws", () => {
    it("surfaces the mandated rejection prefix with the reason", async () => {
      const adapter = {
        connect: async () => {
          throw new Error("socket closed 1006");
        },
      };
      const wrapped = wrapConnectRejection(adapter, 1000);

      await expect(wrapped.connect()).rejects.toThrow(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: socket closed 1006`,
      );
    });
  });

  describe("when the underlying connect hangs", () => {
    it("rejects at the timeout rather than hanging", async () => {
      const adapter = { connect: () => new Promise<void>(() => {}) };
      const wrapped = wrapConnectRejection(adapter, 20);

      await expect(wrapped.connect()).rejects.toThrow(
        new RegExp(
          `^${ELEVENLABS_CONNECT_REJECTED_PREFIX}: connection timed out`,
        ),
      );
    });
  });

  describe("when the underlying connect succeeds", () => {
    it("resolves without wrapping", async () => {
      let called = false;
      const adapter = {
        connect: async () => {
          called = true;
        },
      };
      await wrapConnectRejection(adapter, 1000).connect();
      expect(called).toBe(true);
    });
  });
});
