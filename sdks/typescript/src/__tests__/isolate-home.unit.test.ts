import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFIG_LOCATION_VARS,
  TEST_HOME_PREFIX,
  isolateHome,
} from "../../__tests__/helpers/isolate-home";
import { appSettingsTargetFor } from "../cli/utils/governance/app-settings";

describe("isolateHome", () => {
  describe("when the shell points CLAUDE_CONFIG_DIR and other config dirs at real folders", () => {
    it("drops them and moves HOME to a temp directory", () => {
      const env: NodeJS.ProcessEnv = { HOME: "/Users/someone" };
      for (const name of CONFIG_LOCATION_VARS) {
        env[name] = `/Users/someone/${name}`;
      }

      const home = isolateHome(env);

      expect(path.basename(home).startsWith(TEST_HOME_PREFIX)).toBe(true);
      expect(env.HOME).toBe(home);
      expect(env.USERPROFILE).toBe(home);
      for (const name of CONFIG_LOCATION_VARS) {
        expect(env[name]).toBeUndefined();
      }
      fs.rmSync(home, { recursive: true, force: true });
    });
  });

  describe("when a test file starts", () => {
    it("resolves claude's settings.json under the temp HOME, not CLAUDE_CONFIG_DIR", () => {
      const home = process.env.HOME ?? "";

      expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(path.basename(home).startsWith(TEST_HOME_PREFIX)).toBe(true);
      expect(appSettingsTargetFor("claude")?.path).toBe(
        path.join(home, ".claude", "settings.json"),
      );
    });
  });
});
