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
    /** @scenario "pnpm start stays in production mode on a machine with a dev .env" */
    it("restores the process-level value and warns", () => {
      process.env.NODE_ENV = "development"; // what dotenv override left behind
      const warn = vi.fn();

      keepProcessNodeEnv({ valueBeforeDotenv: "production", warn });

      expect(process.env.NODE_ENV).toBe("production");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toContain('NODE_ENV="development"');
    });
  });

  // Unsetting it here is what `pnpm start:app` used to die on: env-create.mjs
  // validates NODE_ENV as a required z.enum, so an unset value is not "no mode"
  // but a hard startup failure ("NODE_ENV: Required"). With no process-level
  // value there is also no production boot to protect, so the guard has nothing
  // to do and must leave .env's answer alone.
  describe("when the process declared no NODE_ENV of its own", () => {
    it("leaves the .env value in place, so the app can still boot", () => {
      process.env.NODE_ENV = "development";
      const warn = vi.fn();

      keepProcessNodeEnv({ valueBeforeDotenv: undefined, warn });

      expect(process.env.NODE_ENV).toBe("development");
    });

    it("stays silent, because nothing was overridden", () => {
      process.env.NODE_ENV = "development";
      const warn = vi.fn();

      keepProcessNodeEnv({ valueBeforeDotenv: undefined, warn });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when .env did not touch NODE_ENV", () => {
    it("keeps the value and stays silent", () => {
      process.env.NODE_ENV = "production";
      const warn = vi.fn();

      keepProcessNodeEnv({ valueBeforeDotenv: "production", warn });

      expect(process.env.NODE_ENV).toBe("production");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
