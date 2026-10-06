/** The spend-command spine's ingest: validate and price each record, attribute it, hand it on. */
import {
  GATEWAY_INTERNAL_SPEND_COMMANDS,
  type GatewayInternalSpendCommandName,
  type GatewayInternalSpendCommandRecord,
  type GatewayInternalSpendSubmission,
  type GatewayPricedSpend,
  type GatewayPricedSpendResult,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
} from "../eventing/gateway-spend-commands.process.ts";
import type { GatewayInternalStoreRepository } from "../repositories/gateway-internal-store.repository.ts";
import {
  asString,
  attributedIdentity,
  pricedSpendCommandData,
  rejectedRecordIdentity,
} from "../rules/gateway-spend-command.rules.ts";
import type {
  GatewayInternalSpendPipeline,
  GatewaySpendCommandSender,
} from "./gateway-internal-protocol.service.ts";
import type { GatewaySpendRating } from "./model-catalog-gateway-spend-rating.service.ts";

const logger = createLogger("langwatch:gateway-internal");

/** What the spine reaches: the registered pipeline, the key rows and the project directory. */
type GatewaySpendCommandIngestMembers = Readonly<{
  spend: GatewayInternalSpendPipeline | undefined;
  store: GatewayInternalStoreRepository;
  projects: Pick<ProjectApi, "listNamesByIds">;
}>;

export class GatewaySpendCommandIngestService {
  static create(members: GatewaySpendCommandIngestMembers): GatewaySpendCommandIngestService {
    return new GatewaySpendCommandIngestService(members);
  }

  private constructor(private readonly members: GatewaySpendCommandIngestMembers) {}

  async submitSpendCommands(
    records: GatewayInternalSpendCommandRecord[],
  ): Promise<GatewayInternalSpendSubmission> {
    const pipeline = this.members.spend;
    if (!pipeline) return { status: "unavailable" } as const;
    const { perCommand, rejected } = groupSpendCommands(records, pipeline.rating);
    await enrichAttributedCommands({
      store: this.members.store,
      projects: this.members.projects,
      admits: perCommand.admitSpend,
      outcomes: [...perCommand.confirmSpend, ...perCommand.failSpend],
    });
    const sent = await sendSpendCommands(pipeline.commands, perCommand);
    if (!sent.sent) return { status: "unregistered", command: sent.unregistered } as const;
    return { status: "accepted", accepted: records.length - rejected.length, rejected } as const;
  }

  /**
   * Appends one outcome the caller priced itself. Straight onto the pipeline's
   * `confirmSpend`, not through the drain path: that re-rates every outcome
   * against the model registry, which holds no entry for a judgement.
   */
  async recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult> {
    const sender = this.members.spend?.commands.confirmSpend;
    if (!sender) return { status: "unavailable" } as const;
    await sender.send(pricedSpendCommandData(input));

    return { status: "recorded" } as const;
  }
}

const SPEND_COMMAND_SCHEMAS = {
  admitSpend: admitSpendWireSchema,
  confirmSpend: confirmSpendWireSchema,
  failSpend: failSpendWireSchema,
} as const;

interface SpendCommandReject {
  code: string;
  message: string;
  issues?: unknown[];
}

/**
 * The single seam that prices an outcome. The wire carries quantities, never
 * money, so the server rates once here and every downstream reader copies the
 * figure, not a moving catalog.
 */
function pricedOutcomeData(
  data: Record<string, unknown> & {
    model: string;
    usage: SpendUsage;
    rate_version?: string;
  },
  rating: GatewaySpendRating,
): Record<string, unknown> {
  const rated = rating.rate({
    model: data.model,
    usage: data.usage,
    rateVersion: data.rate_version,
  });

  return { ...data, cost_nano_usd: rated.costNanoUsd, rate_version: rated.rateVersion };
}

/**
 * The internal command data one wire record maps to, or why it cannot be
 * accepted. `project_id` on the wire is the internal `tenantId`; only admits
 * carry the pod identity the gap detector reads.
 */
function toSpendCommandData(
  record: GatewayInternalSpendCommandRecord,
  rating: GatewaySpendRating,
): { ok: true; data: Record<string, unknown> } | { ok: false; reject: SpendCommandReject } {
  const wire = record.payload;
  const projectId = wire.project_id;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return {
      ok: false,
      reject: {
        code: "missing_project_id",
        message: "spend command record rejected: missing project_id",
      },
    };
  }

  const { project_id: _projectId, ...rest } = wire;
  const mapped: Record<string, unknown> =
    record.command === "admitSpend"
      ? { ...rest, tenantId: projectId, pod_id: record.pod_id, pod_seq: record.pod_seq }
      : { ...rest, tenantId: projectId };
  const validated = SPEND_COMMAND_SCHEMAS[record.command].safeParse(mapped);
  if (!validated.success) {
    return {
      ok: false,
      reject: {
        code: "invalid_payload",
        message: "spend command record rejected",
        issues: validated.error.issues.slice(0, 3),
      },
    };
  }

  const data: Record<string, unknown> = validated.data;
  if (record.command === "admitSpend") {
    return { ok: true, data };
  }

  const outcome =
    record.command === "confirmSpend"
      ? confirmSpendWireSchema.parse(mapped)
      : failSpendWireSchema.parse(mapped);

  return {
    ok: true,
    data: pricedOutcomeData(
      {
        ...outcome,
        usage: outcome.usage ?? {},
      },
      rating,
    ),
  };
}

/**
 * Group the batch by command, reporting unacceptable records by index. Every
 * reject path logs: a silent per-record drop looks like a healthy 200 from the
 * emitter's side and loses billing records.
 */
function groupSpendCommands(
  records: GatewayInternalSpendCommandRecord[],
  rating: GatewaySpendRating,
): {
  perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]>;
  rejected: { index: number; code: string }[];
} {
  const perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]> = {
    admitSpend: [],
    confirmSpend: [],
    failSpend: [],
  };
  const rejected: { index: number; code: string }[] = [];

  records.forEach((record, index) => {
    const mapped = toSpendCommandData(record, rating);
    if (!mapped.ok) {
      rejected.push({ index, code: mapped.reject.code });
      // Error, not warn: the drainer reads a 200 and acks the segment, so this
      // line is the only trace the record ever existed. It names the request
      // because "a record was rejected" cannot be reconciled against anything.
      logger.error(
        {
          command: record.command,
          index,
          code: mapped.reject.code,
          ...rejectedRecordIdentity(record),
          ...(mapped.reject.issues ? { issues: mapped.reject.issues } : {}),
        },
        mapped.reject.message,
      );

      return;
    }
    perCommand[record.command].push(mapped.data);
  });

  return { perCommand, rejected };
}

/**
 * How stale `lastUsedAt` has to be before a drain batch advances it. Admin
 * oversight reads the column on minute scale, so writing it per request would
 * buy nothing.
 */
const VIRTUAL_KEY_TOUCH_THROTTLE_MS = 60_000;

/** The key row an admission is attributed against. */
type AttributionVirtualKey = {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  lastUsedAt: Instant | null;
};

/** Best effort: oversight, not enforcement, so a failure must not retry already-billed records. */
async function touchAdmittedVirtualKeys(
  store: GatewayInternalStoreRepository,
  virtualKeys: AttributionVirtualKey[],
  now: Instant,
): Promise<void> {
  const staleIds = virtualKeys
    .filter(
      (vk) =>
        !vk.lastUsedAt ||
        now.epochMilliseconds - vk.lastUsedAt.epochMilliseconds > VIRTUAL_KEY_TOUCH_THROTTLE_MS,
    )
    .map((vk) => vk.id);
  if (staleIds.length === 0) return;

  // The failure is swallowed by the adapter and logged there, for the reason
  // its own docblock gives: this column is oversight, and failing a batch of
  // billing records over it would cost the drainer a retry of records that
  // already appended.
  await store.touchVirtualKeysLastUsed({ virtualKeyIds: staleIds, now });
}

/**
 * Joins every admission to attribution the gateway cannot see, via two
 * batched reads. A missing key/team degrades to empty attribution (logged);
 * a Prisma failure 500s so the drainer retries — nothing is silently dropped.
 */
function reportAttributionGaps({
  identity,
  key,
  teamId,
}: {
  identity: ReturnType<typeof attributedIdentity>;
  key: AttributionVirtualKey | undefined;
  teamId: string;
}): void {
  if (!key) {
    logger.error(
      identity,
      "spend admission names a virtual key that no longer exists: principal and group budgets will not see this request",
    );
  } else if (key.organizationId !== identity.organizationId) {
    logger.error(
      { ...identity, keyOrganizationId: key.organizationId },
      "spend admission names a virtual key from another organization",
    );
  }
  if (!teamId) {
    logger.error(
      identity,
      "spend admission names a project with no team: team budgets will not see this request",
    );
  }
}

async function enrichAttributedCommands({
  store,
  projects: projectDirectory,
  admits,
  outcomes,
}: {
  store: GatewayInternalStoreRepository;
  projects: Pick<ProjectApi, "listNamesByIds">;
  admits: Record<string, unknown>[];
  outcomes: Record<string, unknown>[];
}): Promise<void> {
  // An outcome from a build predating attribution-on-outcome names no key, so
  // there is nothing to join against — those requests keep the admit-time join
  // in the consuming process managers (outcome_carries_attribution tells them to
  // do exactly that), so skipping here is the correct no-op. Silent by design:
  // one line per record through a fleet roll says nothing actionable.
  const attributableOutcomes = outcomes.filter(
    (outcome) => asString(outcome.virtual_key_id) !== "",
  );
  const commands = [...admits, ...attributableOutcomes];
  if (commands.length === 0) return;

  const identities = commands.map(attributedIdentity);
  const [virtualKeys, projects] = await Promise.all([
    store.findVirtualKeysForAttribution([...new Set(identities.map((i) => i.virtualKeyId))]),
    projectDirectory.listNamesByIds({
      projectIds: [...new Set(identities.map((i) => i.projectId))],
    }),
  ]);
  const keyById = new Map(virtualKeys.map((vk) => [vk.id, vk]));
  const teamIdByProject = new Map(projects.map((p) => [p.id, p.teamId]));

  commands.forEach((command, index) => {
    const identity = identities[index]!;
    const key = keyById.get(identity.virtualKeyId);
    const teamId = teamIdByProject.get(identity.projectId) ?? "";
    // Only the admission reports these. An outcome names the same key and the
    // same project, so reporting both would say everything twice.
    if (index < admits.length) {
      reportAttributionGaps({ identity, key, teamId });
    }
    command.principal_user_id = key?.principalUserId ?? "";
    command.team_id = teamId;
  });

  // Admission is what marks a key used. An outcome is the same request arriving
  // a second time, so touching on both would double the writes to say the same
  // thing.
  const admittedKeyIds = new Set(identities.slice(0, admits.length).map((i) => i.virtualKeyId));
  await touchAdmittedVirtualKeys(
    store,
    virtualKeys.filter((vk) => admittedKeyIds.has(vk.id)),
    nowInstant(),
  );
}

/**
 * Hand each command's group to the pipeline, preferring the batched sender where
 * the command exposes one. Answers the command whose sender is missing, which is
 * a registration bug the caller reports as a 503.
 */
async function sendSpendCommands(
  commands: Record<string, GatewaySpendCommandSender | undefined>,
  perCommand: Record<GatewayInternalSpendCommandName, Record<string, unknown>[]>,
): Promise<{ sent: true } | { sent: false; unregistered: GatewayInternalSpendCommandName }> {
  for (const name of GATEWAY_INTERNAL_SPEND_COMMANDS) {
    const batch = perCommand[name];
    if (batch.length === 0) continue;

    const sender = commands[name];
    if (!sender) return { sent: false, unregistered: name };

    if (sender.sendBatch) {
      await sender.sendBatch(batch);
      continue;
    }
    for (const payloadItem of batch) {
      await sender.send(payloadItem);
    }
  }

  return { sent: true };
}
