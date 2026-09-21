import { mintProjectIngestionKey } from "./cli-api";
import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import { deviceLabelForThisMachine } from "./device-label";
import { SOURCE_TYPE_BY_TOOL } from "./otel-env-block";

/**
 * Pin a tool's telemetry to a team project: mint a project ingest key
 * (create-only server-side, one per device, so other machines keep
 * theirs) and store it under `tool_project_keys[tool]`. While the pin
 * exists the wrapper and `langwatch instrument` wire the tool with this
 * key and never consult or rewrite the personal path.
 */
export async function pinToolToProject({
	cfg,
	tool,
	project,
}: {
	cfg: GovernanceConfig;
	tool: string;
	project: string;
}): Promise<{ label: string }> {
	const sourceType = SOURCE_TYPE_BY_TOOL[tool];
	if (!sourceType) {
		throw new Error(
			`--project is not supported for '${tool}': it has no direct OTLP ingestion path.`,
		);
	}
	const minted = await mintProjectIngestionKey(cfg, {
		sourceType,
		project,
		deviceLabel: deviceLabelForThisMachine(),
	});
	cfg.tool_project_keys = {
		...(cfg.tool_project_keys ?? {}),
		[tool]: {
			secret: minted.token,
			project_id: minted.project.id,
			project_slug: minted.project.slug,
		},
	};
	saveConfig(cfg);
	return { label: minted.project.slug };
}

/**
 * Pin a tool to a pasted ingest key (`--key`), for machines that never
 * log in. The endpoint travels with the pin when it differs from the
 * config's control plane.
 */
export function pinToolToKey({
	cfg,
	tool,
	key,
	endpoint,
}: {
	cfg: GovernanceConfig;
	tool: string;
	key: string;
	endpoint?: string;
}): void {
	cfg.tool_project_keys = {
		...(cfg.tool_project_keys ?? {}),
		[tool]: {
			secret: key,
			...(endpoint ? { endpoint } : {}),
		},
	};
	saveConfig(cfg);
}

/** Clear a tool's project pin. Returns false when there was none. */
export function clearToolProjectPin({
	cfg,
	tool,
}: {
	cfg: GovernanceConfig;
	tool: string;
}): boolean {
	if (!cfg.tool_project_keys?.[tool]) return false;
	const { [tool]: _dropped, ...rest } = cfg.tool_project_keys;
	cfg.tool_project_keys = rest;
	saveConfig(cfg);
	return true;
}
