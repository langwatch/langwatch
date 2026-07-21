/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "pnpm start stays in production
 * mode on a machine with a dev .env"
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { keepProcessNodeEnv } from "../env-mode-guard";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("keepProcessNodeEnv", () => {
  describe("when .env overrode NODE_ENV after the process set it", () => {
    it("restores the process-level value and warns", () => {
      process.env.NODE_ENV = "development"; // what dotenv override left behind
      const warn = vi.fn();

      keepProcessNodeEnv("production", warn);

      expect(process.env.NODE_ENV).toBe("production");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain('NODE_ENV="development"');
    });

    it("unsets NODE_ENV when the process had none before dotenv", () => {
      process.env.NODE_ENV = "development";
      const warn = vi.fn();

      keepProcessNodeEnv(undefined, warn);

      expect(process.env.NODE_ENV).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe("when .env did not touch NODE_ENV", () => {
    it("keeps the value and stays silent", () => {
      process.env.NODE_ENV = "production";
      const warn = vi.fn();

      keepProcessNodeEnv("production", warn);

      expect(process.env.NODE_ENV).toBe("production");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
