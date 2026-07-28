import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";

import {
  type ModelDefaultScopeType,
  ModelDefaultsApiService,
} from "@/client-sdk/services/model-defaults/model-defaults-api.service";

import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

type ScopeKind = "project" | "team" | "organization";

export interface UnsetModelDefaultOptions {
  scope?: ScopeKind;
  scopeId?: string;
}

function resolveScope(
  options: UnsetModelDefaultOptions,
  snapshotScope: {
    projectId: string;
    teamId: string | null;
    organizationId: string | null;
  },
): { scopeType: ModelDefaultScopeType; scopeId: string } {
  const kind: ScopeKind = options.scope ?? "project";

  if (options.scopeId) {
    return { scopeType: kind.toUpperCase() as ModelDefaultScopeType, scopeId: options.scopeId };
  }
  if (kind === "project") {
    return { scopeType: "PROJECT", scopeId: snapshotScope.projectId };
  }
  if (kind === "team") {
    if (!snapshotScope.teamId) {
      throw new Error(
        "No team scope available for this API key. Pass --scope-id <teamId> explicitly.",
      );
    }
    return { scopeType: "TEAM", scopeId: snapshotScope.teamId };
  }
  if (!snapshotScope.organizationId) {
    throw new Error(
      "No organization scope available for this API key. Pass --scope-id <organizationId> explicitly.",
    );
  }
  return { scopeType: "ORGANIZATION", scopeId: snapshotScope.organizationId };
}

/**
 * Remove a single key from the config attached at the target scope.
 * If the config has no other keys left, deletes it outright — an empty
 * config doesn't carry any cascade signal and occupies the same-scope
 * tiebreak slot.
 *
 * Returns what it did rather than printing it: the output port renders the
 * result in whatever format the caller asked for (utils/output.ts). The two
 * mutating paths keep the shape the previous `--format json` branch
 * established. The no-op path used to emit NOTHING in json mode — a silent
 * exit 0 that a machine caller could not distinguish from a successful
 * removal — so it now answers the same shape carrying `noop: true`.
 */
export const unsetModelDefaultCommand = async (
  key: string,
  options: UnsetModelDefaultOptions,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ModelDefaultsApiService();
  const spinner = createSpinner(`Unsetting ${chalk.cyan(key)}...`).start();

  try {
    const snapshot = await service.getSnapshot();
    const target = resolveScope(options, snapshot.scope);

    const existing = snapshot.configs.filter((c) =>
      c.scopes.some(
        (s) => s.type === target.scopeType && s.id === target.scopeId,
      ),
    );

    if (existing.length === 0 || !existing.some((c) => key in c.config)) {
      spinner.succeed(
        `No ${chalk.cyan(key)} entry at ${target.scopeType.toLowerCase()}:${target.scopeId}; nothing to do.`,
      );
      return {
        data: { id: null, key, scope: target, deleted: false, noop: true },
        table: () => {
          // Nothing further to print: the spinner line above was the whole
          // human output before the migration, and stays so.
        },
      };
    }

    const sorted = [...existing].sort((a, b) =>
      a.createdAt > b.createdAt ? -1 : 1,
    );
    const current = sorted[0]!;
    const nextPayload: Record<string, string> = { ...current.config };
    delete nextPayload[key];

    if (Object.keys(nextPayload).length === 0) {
      await service.deleteConfig(current.id);
      spinner.succeed(
        `Deleted config ${chalk.green(current.id)} (no keys left) at ${target.scopeType.toLowerCase()}:${target.scopeId}`,
      );
      return {
        data: { id: current.id, key, scope: target, deleted: true, noop: false },
        table: () => {
          // Nothing further to print: the spinner line above was the whole
          // human output before the migration, and stays so.
        },
      };
    }

    await service.updateConfig(current.id, { config: nextPayload });
    spinner.succeed(
      `Removed ${chalk.cyan(key)} from config ${chalk.green(current.id)} at ${target.scopeType.toLowerCase()}:${target.scopeId}`,
    );
    return {
      data: { id: current.id, key, scope: target, deleted: false, noop: false },
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "unset default model" });
    process.exit(1);
  }
};
