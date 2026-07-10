/**
 * Enumerate every place `langwatch <tool>` persists telemetry wiring, so
 * `langwatch logout` can discover and remove all of it. Each target knows
 * whether it is currently present on disk and how to remove itself, and
 * every remover only ever touches the langwatch-authored region (a
 * marker-bracketed block or a known key set), never surrounding user
 * config.
 *
 * This is the inverse of the install surface:
 *   - claude   → OTEL keys in ~/.claude/settings.json's `env`
 *   - codex    → the [otel] + gateway marker blocks in ~/.codex/config.toml
 *                and the sibling langwatch profile file
 *   - gemini / opencode → a scoped shell function under the tool's marker
 *                pair in the shell rc
 *   - the global gateway export block in the shell rc (init-shell / legacy)
 *
 * Shell rc files are scanned for ALL supported shells (zsh/bash/fish), not
 * just $SHELL, so a block written to ~/.zshrc is still found from a bash
 * session — the user asked it to "go and find it".
 */

import * as fs from "node:fs";
import * as os from "node:os";

import {
  codexHasGatewayBlock,
  codexHasOtelBlock,
  defaultCodexConfigPath,
  defaultCodexProfilePath,
  displayCodexConfigPath,
  removeCodexGatewayBlock,
  removeCodexGatewayProfileFile,
  removeCodexOtelBlock,
} from "../codex-config-toml";
import {
  appEnvHasAnyVar,
  appSettingsTargetFor,
  removeAppEnvVars,
} from "./app-settings";
import {
  type DetectedShell,
  GATEWAY_RC_MARKERS,
  rcHasLangwatchBlock,
  rcPath,
  removeBlockFromRc,
  SHELL_FUNCTION_TOOLS,
  toolMarkers,
} from "./shell-rc";
import { telemetryEnvVarNames } from "./wrapper-mode";

export interface TelemetryTarget {
  /** Human label for the confirm list + removal summary. */
  label: string;
  /** Whether the wiring is currently present on disk. */
  present: boolean;
  /** Remove it. Returns true when something was actually removed. */
  remove: () => boolean;
}

const SHELLS: DetectedShell[] = ["zsh", "bash", "fish"];


/** Render an absolute path with the home dir collapsed to `~`. */
function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/**
 * Enumerate every telemetry-persist target with a present flag and a
 * remover. Callers filter to `present` targets for display + removal.
 */
export function scanTelemetryTargets(): TelemetryTarget[] {
  const targets: TelemetryTarget[] = [];

  // claude — OTEL keys inside ~/.claude/settings.json's `env` object.
  const claudeTarget = appSettingsTargetFor("claude");
  if (claudeTarget) {
    const keys = telemetryEnvVarNames("claude");
    targets.push({
      label: `claude telemetry env (${claudeTarget.displayPath})`,
      present: appEnvHasAnyVar(claudeTarget, keys),
      remove: () => removeAppEnvVars(claudeTarget, keys),
    });
  }

  // codex — [otel] + gateway marker blocks in config.toml + the profile file.
  const codexConfig = defaultCodexConfigPath();
  targets.push({
    label: `codex [otel] block (${displayCodexConfigPath()})`,
    present: codexHasOtelBlock(codexConfig),
    remove: () => removeCodexOtelBlock(codexConfig),
  });
  targets.push({
    label: `codex gateway block (${displayCodexConfigPath()})`,
    present: codexHasGatewayBlock(codexConfig),
    remove: () => removeCodexGatewayBlock(codexConfig),
  });
  const codexProfile = defaultCodexProfilePath();
  targets.push({
    label: `codex langwatch profile file (${tildify(codexProfile)})`,
    present: fs.existsSync(codexProfile),
    remove: () => removeCodexGatewayProfileFile(codexProfile),
  });

  // shell rc files — the global gateway block + per-tool scoped functions.
  for (const shell of SHELLS) {
    targets.push({
      label: `gateway shell block (${tildify(rcPath(shell))})`,
      present: rcHasLangwatchBlock({ shell, markers: GATEWAY_RC_MARKERS }),
      remove: () => removeBlockFromRc(shell, GATEWAY_RC_MARKERS),
    });
    for (const tool of SHELL_FUNCTION_TOOLS) {
      const markers = toolMarkers(tool);
      targets.push({
        label: `${tool} shell function (${tildify(rcPath(shell))})`,
        present: rcHasLangwatchBlock({ shell, markers }),
        remove: () => removeBlockFromRc(shell, markers),
      });
    }
  }

  return targets;
}
