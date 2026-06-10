import chalk from "chalk";
import ora from "ora";

import {
  type ModelDefaultScopeType,
  ModelDefaultsApiService,
} from "@/client-sdk/services/model-defaults/model-defaults-api.service";

import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

type ScopeKind = "project" | "team" | "organization";

export interface SetModelDefaultOptions {
  scope?: ScopeKind;
  scopeId?: string;
  format?: string;
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
 * Set a default model at the chosen scope. Read-modify-write: looks up
 * the existing config attached to the target scope and merges the new
 * key, or creates a new config when nothing is attached. Mirrors the
 * server-side `setRoleAtScope` upsert so CLI and UI converge on the
 * same single-config-per-scope shape.
 */
export const setModelDefaultCommand = async (
  key: string,
  model: string,
  options: SetModelDefaultOptions,
): Promise<void> => {
  checkApiKey();

  const service = new ModelDefaultsApiService();
  const spinner = ora(
    `Setting ${chalk.cyan(key)} → ${chalk.green(model)}...`,
  ).start();

  try {
    const snapshot = await service.getSnapshot();
    const target = resolveScope(options, snapshot.scope);

    const existing = snapshot.configs
      .filter((c) =>
        c.scopes.some(
          (s) => s.type === target.scopeType && s.id === target.scopeId,
        ),
      )
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

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
      if (options.format === "json") {
        console.log(
          JSON.stringify(
            { id: current.id, key, model, scope: target, created: false },
            null,
            2,
          ),
        );
      }
      return;
    }

    const created = await service.createConfig({
      config: { [key]: model },
      scopes: [target],
    });
    spinner.succeed(
      `Created config ${chalk.green(created.id)} at ${target.scopeType.toLowerCase()}:${target.scopeId}`,
    );
    if (options.format === "json") {
      console.log(
        JSON.stringify(
          { id: created.id, key, model, scope: target, created: true },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "set default model" });
    process.exit(1);
  }
};
