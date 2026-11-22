import chalk from "chalk";

import {
  type ModelDefaultScopeType,
  ModelDefaultsApiService,
} from "@/client-sdk/services/model-defaults/model-defaults-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

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
    return {
      scopeType: kind.toUpperCase() as ModelDefaultScopeType,
      scopeId: options.scopeId,
    };
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
 * Remove key from config at scope; delete config if empty.
 * No-op path carries noop: true so callers distinguish from successful removal.
 */
export const unsetModelDefaultCommand = async (
  key: string,
  options: UnsetModelDefaultOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ModelDefaultsApiService();
  const spinner = createSpinner(`Unsetting ${chalk.cyan(key)}...`).start();

  try {
    const snapshot = await service.getSnapshot();
    const target = resolveScope(options, snapshot.scope);

    const existing = snapshot.configs.filter((c) =>
      c.scopes.some((s) => s.type === target.scopeType && s.id === target.scopeId),
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

    const sorted = [...existing].toSorted((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
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
