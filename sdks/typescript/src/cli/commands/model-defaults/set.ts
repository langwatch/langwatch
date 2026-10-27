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

export interface SetModelDefaultOptions {
  scope?: ScopeKind;
  scopeId?: string;
}

function resolveScope(
  options: SetModelDefaultOptions,
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
 * Set default model at scope: read-modify-write upsert.
 * Returns created discriminator so callers distinguish upsert from fresh config.
 */
export const setModelDefaultCommand = async (
  key: string,
  model: string,
  options: SetModelDefaultOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ModelDefaultsApiService();
  const spinner = createSpinner(`Setting ${chalk.cyan(key)} → ${chalk.green(model)}...`).start();

  try {
    const snapshot = await service.getSnapshot();
    const target = resolveScope(options, snapshot.scope);

    const existing = snapshot.configs
      .filter((c) => c.scopes.some((s) => s.type === target.scopeType && s.id === target.scopeId))
      .toSorted((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

    const current = existing[0];
    if (current) {
      const nextPayload: Record<string, string> = {
        ...current.config,
        [key]: model,
      };
      await service.updateConfig(current.id, { config: nextPayload });
      spinner.succeed(
        `Updated config ${chalk.green(current.id)} at ${target.scopeType.toLowerCase()}:${target.scopeId}`,
      );
      return {
        data: { id: current.id, key, model, scope: target, created: false },
        table: () => {
          // Nothing further to print: the spinner line above was the whole
          // human output before the migration, and stays so.
        },
      };
    }

    const created = await service.createConfig({
      config: { [key]: model },
      scopes: [target],
    });
    spinner.succeed(
      `Created config ${chalk.green(created.id)} at ${target.scopeType.toLowerCase()}:${target.scopeId}`,
    );
    return {
      data: { id: created.id, key, model, scope: target, created: true },
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "set default model" });
    process.exit(1);
  }
};
