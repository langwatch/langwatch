/**
 * Explicitly loads `.env` and then the `.env.portless` overlay (haven).
 * Importing this module is side-effect free; executable entrypoints call
 * `loadEnvironment()` before importing modules that can reach the legacy app
 * graph.
 *
 * `override: true` lets `.env` win over values that scripts/start.sh exported
 * before the entry runs. The portless overlay loads last so haven-resolved
 * hostnames and ports win over values pinned in `.env`.
 */
import dotenv from "dotenv";
import { existsSync } from "fs";
import { keepProcessNodeEnv } from "./server/env-mode-guard";

export function loadEnvironment(): void {
  const quiet = process.env.NODE_ENV !== "development";
  const nodeEnvBeforeDotenv = process.env.NODE_ENV;
  const rootEnvPath = "../../.env";
  const legacyEnvPath = ".env";
  const rootOverlayPath = "../../.env.portless";
  const legacyOverlayPath = ".env.portless";
  const envPath = existsSync(rootEnvPath) ? rootEnvPath : legacyEnvPath;
  const overlayPath = existsSync(rootOverlayPath) ? rootOverlayPath : legacyOverlayPath;

  dotenv.config({ path: envPath, override: true, quiet });
  dotenv.config({
    path: overlayPath,
    override: true,
    quiet: quiet || !existsSync(overlayPath),
  });
  // NODE_ENV is a runtime mode, not configuration. Keep the shell-selected
  // value when an env file contains a conflicting value.
  keepProcessNodeEnv({ valueBeforeDotenv: nodeEnvBeforeDotenv });
}
