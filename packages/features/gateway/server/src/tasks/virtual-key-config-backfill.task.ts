import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { nanoid } from "nanoid";
import type {
  BackfillJsonObject,
  BackfillJsonValue,
  GatewayVirtualKeyConfigBackfillRepository,
  VirtualKeyRow,
} from "../repositories/gateway-virtual-key-config-backfill.repository";

const logger = createLogger("langwatch:task:virtual-key-config-backfill");

/** What the walk reads out of the key's Json config column. */
export type LegacyVirtualKeyConfig = Readonly<{
  modelAliases: Record<string, string>;
  policyRules: BackfillJsonObject | undefined;
  guardrails: Readonly<Record<Direction, ReadonlyArray<{ id: string; evaluator: string }>>>;
  requestFailOpen: boolean;
  responseFailOpen: boolean;
}>;

/**
 * `VirtualKeyScopeType` and `RoutingPolicyScopeType` are separate enums with
 * identical members, so the clone maps across them rather than assigning: the
 * compiler refuses the assignment, and rightly.
 */
const POLICY_SCOPE_TYPE = {
  ORGANIZATION: "ORGANIZATION",
  TEAM: "TEAM",
  PROJECT: "PROJECT",
} as const;

/** The guardrail column's own spelling of each legacy direction. */
const GUARDRAIL_DIRECTION = {
  pre: "PRE",
  post: "POST",
  streamChunk: "STREAM_CHUNK",
} as const;

type Direction = keyof typeof GUARDRAIL_DIRECTION;
const DIRECTIONS = ["pre", "post", "streamChunk"] as const satisfies readonly Direction[];

export type VirtualKeyConfigBackfillOutcome = Readonly<{
  mode: "dry-run" | "execute";
  virtualKeys: number;
  touched: number;
  routingPoliciesMinted: number;
  guardrailsMinted: number;
  skippedWithoutProjectScope: number;
}>;

/**
 * Mints the rows that took over `vk.config`'s legacy keys, then strips them.
 * Migration `20260524163000_strip_vk_config_legacy_keys` names main's script
 * by path and RAISEs on leftover content; this is that script.
 */
export async function backfillVirtualKeyConfig({
  repository,
  execute,
  now = () => new Date(),
}: {
  repository: GatewayVirtualKeyConfigBackfillRepository;
  execute: boolean;
  now?: () => Date;
}): Promise<VirtualKeyConfigBackfillOutcome> {
  const organizationIds = await repository.findOrganizationIds();
  const virtualKeys: VirtualKeyRow[] = [];
  for (const organizationId of organizationIds) {
    virtualKeys.push(...(await repository.findVirtualKeys({ organizationId })));
  }

  let touched = 0;
  let routingPoliciesMinted = 0;
  let guardrailsMinted = 0;
  let skippedWithoutProjectScope = 0;

  for (const virtualKey of virtualKeys) {
    const raw = objectOf(virtualKey.config);
    const config = readLegacyConfig(raw);
    const carries = {
      aliases: hasAliases(config),
      rules: hasPolicyRules(config),
      guardrails: hasGuardrails(config),
    };
    if (!carries.aliases && !carries.rules && !carries.guardrails) continue;

    let routingPolicyId = virtualKey.routingPolicyId;
    if ((carries.aliases || carries.rules) && !routingPolicyId) {
      routingPolicyId = await mintRoutingPolicy({ repository, execute, virtualKey, config, now });
      routingPoliciesMinted += 1;
    }

    const guardrails = carries.guardrails
      ? await mintGuardrails({ repository, execute, virtualKey, config })
      : { attachments: [], minted: 0, skipped: false };
    guardrailsMinted += guardrails.minted;
    if (guardrails.skipped) skippedWithoutProjectScope += 1;

    const next: Record<string, unknown> = { ...raw };
    delete next.modelAliases;
    delete next.policyRules;
    delete next.guardrails;
    if (guardrails.attachments.length > 0) next.guardrailAttachments = guardrails.attachments;

    if (execute) {
      await repository.updateVirtualKeyConfig({
        id: virtualKey.id,
        config: next as BackfillJsonObject,
        routingPolicyId,
      });
    }
    touched += 1;
  }

  const outcome = {
    mode: execute ? ("execute" as const) : ("dry-run" as const),
    virtualKeys: virtualKeys.length,
    touched,
    routingPoliciesMinted,
    guardrailsMinted,
    skippedWithoutProjectScope,
  };
  logger.info({ outcome }, "virtual-key config backfill finished");
  return outcome;
}

/**
 * One policy at the same scope SET as the source key: every VirtualKeyScope
 * row is cloned to a RoutingPolicyScope row. Main also wrote the legacy
 * `scope`/`scopeId` columns; the schema has neither now.
 */
async function mintRoutingPolicy({
  repository,
  execute,
  virtualKey,
  config,
  now,
}: {
  repository: GatewayVirtualKeyConfigBackfillRepository;
  execute: boolean;
  virtualKey: VirtualKeyRow;
  config: LegacyVirtualKeyConfig;
  now: () => Date;
}): Promise<string> {
  const id = `rp_migr_${nanoid()}`;
  if (!execute) return id;
  return repository.mintRoutingPolicy({
    id,
    organizationId: virtualKey.organizationId,
    name: `${virtualKey.name}-migrated-aliases-${stamp(now())}`,
    description: `Auto-migrated from VirtualKey ${virtualKey.id} (${virtualKey.name}).`,
    modelAliases: config.modelAliases,
    policyRules: config.policyRules ?? {},
    scopes: virtualKey.scopes.map((scope) => ({
      scopeType: POLICY_SCOPE_TYPE[scope.scopeType],
      scopeId: scope.scopeId,
    })),
  });
}

/**
 * Guardrails are project-scoped only, so a key held at strict team or
 * organization scope has no anchor to lift them onto. That is reported and
 * skipped rather than guessed at.
 */
async function mintGuardrails({
  repository,
  execute,
  virtualKey,
  config,
}: {
  repository: GatewayVirtualKeyConfigBackfillRepository;
  execute: boolean;
  virtualKey: VirtualKeyRow;
  config: LegacyVirtualKeyConfig;
}): Promise<{
  attachments: Array<{ direction: Direction; guardrailIds: string[] }>;
  minted: number;
  skipped: boolean;
}> {
  const projectScope = virtualKey.scopes.find((scope) => scope.scopeType === "PROJECT");
  if (!projectScope) {
    logger.warn(
      { virtualKeyId: virtualKey.id },
      "this key carries guardrails but has no project scope to lift them onto; skipping",
    );
    return { attachments: [], minted: 0, skipped: true };
  }

  const attachments: Array<{ direction: Direction; guardrailIds: string[] }> = [];
  let minted = 0;
  for (const direction of DIRECTIONS) {
    const refs = config.guardrails[direction];
    if (refs.length === 0) continue;
    const guardrailIds: string[] = [];
    for (const ref of refs) {
      const failOpen = direction === "pre" ? config.requestFailOpen : config.responseFailOpen;
      minted += 1;
      if (!execute) {
        guardrailIds.push(`gr_dryrun_${ref.id}`);
        continue;
      }
      const guardrailId = await repository.mintGuardrail({
        projectId: projectScope.scopeId,
        name: `${ref.evaluator}-${direction}`,
        evaluatorId: ref.id,
        direction: GUARDRAIL_DIRECTION[direction],
        failureMode: failOpen ? "FAIL_OPEN" : "FAIL_CLOSED",
      });
      guardrailIds.push(guardrailId);
    }
    attachments.push({ direction, guardrailIds });
  }
  return { attachments, minted, skipped: false };
}

/** The Json column as an object, or nothing usable at all. */
function objectOf(value: BackfillJsonValue | undefined): BackfillJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * Reads the three legacy keys out of the Json column. Anything malformed reads
 * as absent rather than throwing: a key whose config is not what this expects
 * carries nothing to migrate, and the migration's guard agrees.
 */
function readLegacyConfig(raw: BackfillJsonObject): LegacyVirtualKeyConfig {
  const guardrails = objectOf(raw.guardrails);
  return {
    modelAliases: Object.fromEntries(
      Object.entries(objectOf(raw.modelAliases)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    policyRules: raw.policyRules === undefined ? undefined : objectOf(raw.policyRules),
    guardrails: {
      pre: refsOf(guardrails.pre),
      post: refsOf(guardrails.post),
      streamChunk: refsOf(guardrails.streamChunk),
    },
    requestFailOpen: guardrails.requestFailOpen === true,
    responseFailOpen: guardrails.responseFailOpen === true,
  };
}

/** Only refs carrying both an evaluator id and its name are migratable. */
function refsOf(value: BackfillJsonValue | undefined): Array<{ id: string; evaluator: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const ref = objectOf(entry);
    return typeof ref.id === "string" && typeof ref.evaluator === "string"
      ? [{ id: ref.id, evaluator: ref.evaluator }]
      : [];
  });
}

function hasAliases(config: LegacyVirtualKeyConfig): boolean {
  return Object.keys(config.modelAliases).length > 0;
}

/** The same "non-empty" predicate the migration's guard uses. */
function hasPolicyRules(config: LegacyVirtualKeyConfig): boolean {
  return ["tools", "mcp", "urls", "models"].some((dimension) => {
    const rule = objectOf(config.policyRules?.[dimension]);
    const deny = rule.deny;
    const allow = rule.allow;
    return (Array.isArray(deny) && deny.length > 0) || (Array.isArray(allow) && allow.length > 0);
  });
}

function hasGuardrails(config: LegacyVirtualKeyConfig): boolean {
  return DIRECTIONS.some((direction) => config.guardrails[direction].length > 0);
}

function stamp(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * virtual-key-config-backfill -- --execute`.
 */
export class VirtualKeyConfigBackfillTask extends Task {
  readonly name = "virtual-key-config-backfill";
  readonly description =
    "Mints the routing policies and guardrails that replaced the legacy virtual-key config keys, then strips them. Dry-run unless --execute.";

  private constructor(
    private readonly repository: () => GatewayVirtualKeyConfigBackfillRepository,
  ) {
    super();
  }

  static create({
    repository,
  }: {
    repository: () => GatewayVirtualKeyConfigBackfillRepository;
  }): VirtualKeyConfigBackfillTask {
    return new VirtualKeyConfigBackfillTask(repository);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await backfillVirtualKeyConfig({
      repository: this.repository(),
      execute: args.includes("--execute"),
    });
  }
}
