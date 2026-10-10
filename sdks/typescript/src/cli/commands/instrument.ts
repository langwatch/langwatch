/**
 * Write persistent telemetry wiring for a coding agent without launching it.
 * Supports: personal workspace, --project for team, --key for self-hosted.
 */

import { lwTag } from "../utils/governance/brand";
import { recordCliLocation } from "../utils/governance/cli-location";
import {
  type GovernanceConfig,
  isLoggedIn,
  loadConfig,
  saveConfig,
} from "../utils/governance/config";
import {
  globalConfigIsolationWarning,
  rewritesGlobalConfigForLocalInstance,
} from "../utils/governance/global-config-isolation";
import {
  cleartextIngestEndpointWarning,
  sendsIngestKeyInClear,
} from "../utils/governance/ingest-endpoint-scheme";
import { installTelemetryWiring } from "../utils/governance/instrument-wiring";
import { SOURCE_TYPE_BY_TOOL } from "../utils/governance/otel-env-block";
import { resolvePlatformToolPolicy } from "../utils/governance/platform-tool-policy";
import {
  clearToolProjectPin,
  pinToolToKey,
  pinToolToProject,
} from "../utils/governance/project-scope";
import { resolveIngestionCredential } from "../utils/governance/telemetry-refresh";

export interface InstrumentOptions {
  project?: string;
  key?: string;
  endpoint?: string;
  personal?: boolean;
}

const KEY_ENV_VAR = "LANGWATCH_INGEST_KEY";

function fail(message: string): never {
  process.stderr.write(`${lwTag()} ${message}\n`);
  process.exit(1);
}

type IngestionCredential = Awaited<ReturnType<typeof resolveIngestionCredential>>;

/** The ingest key this run pins, refusing conflicting scope flags. */
function scopeKey(options: InstrumentOptions): string | undefined {
  const explicitScopes = [
    options.project ? "--project" : null,
    options.key ? "--key" : null,
    options.personal ? "--personal" : null,
  ].filter((flag): flag is string => flag !== null);
  if (explicitScopes.length > 1) {
    fail(`pass only one of ${explicitScopes.join(", ")}.`);
  }
  // The environment key is a default, never a choice. A shell that still
  // exports it from an earlier setup would otherwise make `--project` and
  // `--personal` read as a conflict with a flag the user never passed.
  const key =
    options.key ??
    (explicitScopes.length === 0 ? process.env[KEY_ENV_VAR] : undefined) ??
    undefined;
  if (options.endpoint && !key) {
    fail(
      "--endpoint only applies together with --key; logged-in scopes use the endpoint you logged into.",
    );
  }

  return key;
}

/** Pins the scope the flags name, refusing one this device cannot reach. */
async function settleScope({
  cfg,
  tool,
  key,
  options,
}: {
  cfg: GovernanceConfig;
  tool: string;
  key: string | undefined;
  options: InstrumentOptions;
}): Promise<void> {
  if (options.personal) {
    const wasProjectPinCleared = clearToolProjectPin({ cfg, tool });
    if (wasProjectPinCleared) {
      process.stdout.write(`${lwTag()} cleared the project pin for ${tool}.\n`);
    }
  }

  if (key) {
    // Pasted key: no login, no server call. The pin makes every later
    // `langwatch <tool>` run keep this scope instead of re-minting a
    // personal key over it.
    pinToolToKey({ cfg, tool, key, endpoint: options.endpoint });
  } else if (options.project) {
    if (!isLoggedIn(cfg)) {
      fail(
        `--project needs a signed-in session. Run \`langwatch login --device\` first, or use --key with a project ingest key.`,
      );
    }
    const pinned = await pinToolToProject({
      cfg,
      tool,
      project: options.project,
    });
    process.stdout.write(
      `${lwTag()} minted a project ingest key for ${tool} (project ${pinned.label}).\n`,
    );
  } else {
    // A bare re-run on a pinned tool refreshes the wiring for the pin.
    const alreadyPinned = !options.personal && Boolean(cfg.tool_project_keys?.[tool]?.secret);
    if (!alreadyPinned && !isLoggedIn(cfg)) {
      fail(
        `not logged in. Run \`langwatch login --device\` for the personal scope, or pass --key <ingest-key> (or set ${KEY_ENV_VAR}) for a project key.`,
      );
    }
  }
}

/** The personal path can mint on first use; persist the cache like the wrapper does. */
function cacheMintedKey({
  cfg,
  sourceType,
  credential,
}: {
  cfg: GovernanceConfig;
  sourceType: string;
  credential: IngestionCredential;
}): void {
  cfg.default_personal_ingest_keys = {
    ...cfg.default_personal_ingest_keys,
    [sourceType]: { secret: credential.token, prefix: credential.prefix },
  };
  try {
    saveConfig(cfg);
  } catch {
    // The wiring below still lands; only the cache write failed.
    void 0;
  }
}

function reportWiring({
  tool,
  result,
}: {
  tool: string;
  result: ReturnType<typeof installTelemetryWiring>;
}): void {
  for (const warning of result.warnings) {
    process.stderr.write(`${lwTag()} ${warning}\n`);
  }
  // A companion write the wiring depends on failed, so the tool is not
  // wired even where a file was written. Reporting success here would tell
  // the user telemetry is flowing when it is not.
  if (result.requiredFailures.length > 0) {
    for (const failure of result.requiredFailures.slice(0, -1)) {
      process.stderr.write(`${lwTag()} ${failure}\n`);
    }
    fail(result.requiredFailures[result.requiredFailures.length - 1]!);
  }
  if (result.labels.length === 0) {
    fail(`no wiring target was written for ${tool}.`);
  }
  for (const label of result.labels) {
    process.stdout.write(`${lwTag()} wrote telemetry wiring to ${label}.\n`);
  }
}

export async function instrumentCommand(tool: string, options: InstrumentOptions): Promise<void> {
  const sourceType = SOURCE_TYPE_BY_TOOL[tool];
  if (!sourceType) {
    fail(
      `'${tool}' is not an instrumentable tool. Supported: ${Object.keys(SOURCE_TYPE_BY_TOOL).join(", ")}.`,
    );
  }

  const key = scopeKey(options);

  // Before the config is read, so the copy this command saves carries it;
  // the Claude Code plugin's hooks run the CLI through this record.
  recordCliLocation();
  const cfg = loadConfig();

  // Every wiring target this command writes is the direct-OTLP path, the
  // one `allowOtelDirect` governs, so the same gate the wrapper applies
  // before it installs that path applies here. It runs before any mint,
  // pin, or file write, so a refused tool leaves the machine untouched.
  // The mint route re-checks server-side: this one is for the message.
  if (!resolvePlatformToolPolicy(tool, cfg.tool_policies).allowOtelDirect) {
    fail(
      `your organization does not allow ${tool} to send telemetry directly. Run \`langwatch ${tool}\` instead, which routes through the gateway.`,
    );
  }

  await settleScope({ cfg, tool, key, options });

  const credential = await resolveIngestionCredential({
    cfg,
    tool,
    sourceType,
  });
  if (credential.minted) cacheMintedKey({ cfg, sourceType, credential });

  // Warned once here, where the endpoint every wire will post the key to is
  // settled. Warning, not refusing: a private network on plain http is a
  // real deployment, and refusing would take its telemetry and protect nothing.
  if (sendsIngestKeyInClear(credential.endpoint)) {
    process.stderr.write(`${lwTag()} ${cleartextIngestEndpointWarning(credential.endpoint)}\n`);
  }

  // A local endpoint is not a key exposure, but the file written next is the
  // tool's global one, so warn before the write (spec: login-unified.feature).
  if (rewritesGlobalConfigForLocalInstance({ endpoint: credential.endpoint })) {
    process.stderr.write(`${lwTag()} ${globalConfigIsolationWarning(credential.endpoint)}\n`);
  }

  const result = installTelemetryWiring({
    cfg,
    tool,
    endpoint: credential.endpoint,
    token: credential.token,
  });

  reportWiring({ tool, result });
  // The wiring landed, but nothing confirmed the key in it: this device is
  // signed out, so the key could not be checked and could not be replaced.
  // Said after the wiring is known to have been written, and before the
  // success line, so it qualifies a setup that happened rather than one
  // that may have failed for another reason entirely.
  if (credential.sessionExpired) {
    process.stderr.write(
      `${lwTag()} this device is signed out, so \`${tool}\` was wired with the ingest key it already had. If telemetry stops arriving, run \`langwatch login --device\` and then \`langwatch instrument ${tool}\` again.\n`,
    );
  }
  const destination =
    credential.scope === "project"
      ? `project ${credential.projectLabel ?? "(pinned ingest key)"}`
      : "your personal workspace";
  process.stdout.write(
    `${lwTag()} wired \`${tool}\`: plain \`${tool}\` runs now send telemetry to ${destination} at ${credential.endpoint}.\n`,
  );
}
