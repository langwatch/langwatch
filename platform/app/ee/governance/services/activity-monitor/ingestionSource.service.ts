// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * IngestionSourceService — admin CRUD for the per-platform fleet
 * configuration that powers the Activity Monitor pillar (cf.
 * specs/ai-gateway/governance/ingestion-sources.feature,
 * docs/ai-gateway/governance/architecture.md).
 *
 * Org-scoped (no projectId). Optional teamId narrows scope. Auth is
 * enforced at the tRPC / Hono route layer via
 * `checkOrganizationPermission("ingestionSources:view")` for reads and
 * `checkOrganizationPermission("ingestionSources:manage")` for writes. This
 * service does NOT re-check permissions — it trusts the caller resolved them.
 *
 * Secret handling: ingestSecret is auto-generated on create (32 random
 * bytes, base64url) and returned to the caller exactly once. We
 * persist only `ingestSecretHash` (sha256-with-pepper-prefix) so a
 * DB leak doesn't expose live tokens. Rotation mints a new secret +
 * keeps the old hash valid for a 24h grace window via the parserConfig
 * `_rotation` slot — the receiver layer accepts either during the
 * window.
 */

import { pullScheduleSchema } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import { ensureHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import { syncIngestionPullSource } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import { hasPollerCursor } from "@ee/governance/services/pullers/pollerCursor";
import {
  HandledError,
  NotFoundError,
  ValidationError,
} from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { createHash, randomBytes } from "crypto";
import { env } from "~/env.mjs";
import {
  type IngestionSource,
  Prisma,
  type PrismaClient,
} from "~/generated/prisma/client";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import {
  encryptParserConfigCredentials,
  isEncryptedCredentials,
} from "./ingestionCredentials";
import { NON_ENTERPRISE_INGESTION_SOURCE_CAP } from "./ingestionSource.constants";
import { assertPullDestinationAllowed } from "./pullDestination";
import { unsupportedValue } from "./unsupportedValue";

export type SourceType =
  | "otel_generic"
  | "claude_code"
  | "claude_cowork"
  | "workato"
  /** Retired: reads the directory audit, which holds no conversations. */
  | "copilot_studio"
  | "copilot_studio_dataverse"
  | "openai_compliance"
  | "claude_compliance"
  | "anthropic_admin"
  | "databricks_genie"
  | "s3_custom"
  | "http_custom";

export const SUPPORTED_SOURCE_TYPES: readonly SourceType[] = [
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  "copilot_studio",
  "copilot_studio_dataverse",
  "openai_compliance",
  "claude_compliance",
  "anthropic_admin",
  "databricks_genie",
  "s3_custom",
  "http_custom",
] as const;

export interface CreateIngestionSourceInput {
  organizationId: string;
  teamId?: string | null;
  sourceType: SourceType;
  name: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  /**
   * Phase 10: opaque adapter config persisted on IngestionSource.pullConfig.
   * Worker resolves `pullConfig.adapter` through the pullerAdapterRegistry
   * and dispatches `runOnce`. For reference adapters (copilot_studio etc.)
   * the URL/auth/mapping are locked and the admin-supplied portion is just
   * the adapter id + credentials reference.
   */
  pullConfig?: Record<string, unknown> | null;
  /** Five-field UTC cron schedule for the durable pull process. */
  pullSchedule?: string | null;
  /**
   * ADR-088 v7: optional trace destination for conversation-bearing pulls.
   * Null/absent = don't route. Validated to be a live project of this org.
   */
  traceProjectId?: string | null;
  actorUserId: string;
}

export interface UpdateIngestionSourceInput {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  status?: "active" | "disabled" | "awaiting_first_event";
  teamId?: string | null;
  pullSchedule?: string | null;
  /** Undefined = leave alone; null = stop routing; string = new destination. */
  traceProjectId?: string | null;
}

export interface CreatedIngestionSource {
  source: IngestionSource;
  /** Raw ingestSecret — exposed exactly once at creation and never persisted. */
  ingestSecret: string;
}

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
const logger = createLogger("langwatch:governance:ingestion-source");

/**
 * Thrown when a mutation names a source this org doesn't have.
 *
 * The everyday cause is two tabs: one archives a source, the other still
 * shows it and clicks Archive. That is a known cause with an obvious action
 * — reload — so it is handled, not a 500. `meta.id` carries the source id;
 * the org id belongs in the log, not in copy a customer reads.
 */
export class IngestionSourceNotFoundError extends NotFoundError {
  constructor(sourceId: string) {
    super("ingestion_source_not_found", "Ingestion source", sourceId);
    this.name = "IngestionSourceNotFoundError";
  }
}

/**
 * Thrown when a non-enterprise org already holds its full allowance of active
 * ingestion sources.
 *
 * Handled, and raised from the service rather than the router, because that is
 * the whole point of the guard: workers and webhook adapters reach it too, and
 * a `TRPCError` means nothing to them. A plan cap is exactly-known and
 * exactly-actionable — archive one or upgrade — so it gets a code, and
 * `meta.max` lets the UI say the number without the message having to.
 */
export class IngestionSourceCapReachedError extends HandledError {
  declare readonly code: "ingestion_source_cap_reached";

  constructor(max: number) {
    super(
      "ingestion_source_cap_reached",
      `Non-enterprise plans are limited to ${max} ingestion sources.`,
      { httpStatus: 403, meta: { max } },
    );
    this.name = "IngestionSourceCapReachedError";
  }
}

/**
 * The cron field, validated where the rejection can still say something
 * useful about it.
 *
 * The previous guard threw the zod issues away and rethrew a plain `Error`,
 * so a typo in a free-text box became an INTERNAL_SERVER_ERROR: the admin
 * read "Something went wrong — we've been notified" about their own mistake,
 * and a real 5xx incident was booked for it.
 *
 * The complaint rides in `meta.formErrors`, which the `validation_error`
 * registry entry renders verbatim. There is deliberately no `fieldErrors`
 * half: the source composer (`dashboard/pages/ingestion-sources.tsx`) holds
 * its state in `useState`, not `react-hook-form`, so nothing calls
 * `applyHandledErrorToForm` and a `fieldErrors.pullSchedule` key would have
 * no reader. Wiring the composer to `react-hook-form` — so the rejection
 * lands on the input instead of in a toast — is the better end state and is
 * where that half comes back.
 */
function assertPullSchedule(pullSchedule: string): void {
  const parsed = pullScheduleSchema.safeParse(pullSchedule);
  if (parsed.success) return;

  const complaints = parsed.error.issues.map((issue) => issue.message);
  throw new ValidationError(
    complaints.join(" ") || "Pull schedule is not a valid cron expression",
    { meta: { formErrors: complaints } },
  );
}

/**
 * What `assertReportUnchangedOncePulled` permitted, and on what basis.
 *
 * The guard answers a question about a row it read a moment ago, and the write
 * it clears happens later. For most of its answers that gap is harmless — a
 * config that names no report has no report to protect, and an edit that
 * leaves the report alone stays correct however the row moves underneath.
 *
 * One answer is not like the others: a report change is allowed only while the
 * source has no cursor, and a pull run can give it one at any moment. Read at
 * a moment when the column was empty, that permission is already stale by the
 * time it is acted on, and acting on it produces exactly the double-counted
 * spend the guard exists to prevent. So the verdict says which kind of yes it
 * was, and the caller is obliged to hold the row still for the one that needs
 * it. A boolean rather than a re-derivation because the two would drift: the
 * caller would have to ask "was this a report change?" a second time, in its
 * own words, and be wrong about it independently.
 */
export type ReportImmutabilityVerdict = {
  cursorMustNotMove: boolean;
};

/** The row may move freely; nothing this guard allowed depended on it. */
const REPORT_UNAFFECTED: ReportImmutabilityVerdict = {
  cursorMustNotMove: false,
};

/** A report change, allowed only because the cursor was absent when asked. */
const CURSOR_MUST_NOT_MOVE: ReportImmutabilityVerdict = {
  cursorMustNotMove: true,
};

/**
 * Refuse a change of report kind on a source that has already pulled.
 *
 * The Anthropic adapter's two reports price the same spend twice over — its
 * header states the invariant as "Never both", because usage is priced by us
 * and cost is the provider's own figure for the identical consumption. A
 * source obeys that invariant by picking one at create time, and its events
 * carry that choice in their ids: `usage:*` or `cost:*`, never a mix.
 *
 * Editing the report kind is what breaks it. The adapter derives a query
 * identity from the report, so a changed report no longer matches the stored
 * cursor; the cursor is discarded, the new report replays from the backfill
 * start, and its events land in a namespace the old ones never occupied. No
 * row is overwritten because nothing collides — the two sets simply coexist,
 * both counting the same money, which is the outcome the adapter says must
 * never happen.
 *
 * This lives in the service rather than in the form because the invariant is
 * a property of the stored events, not of the drawer: the form declining to
 * offer the edit is a courtesy, and a caller that skips the form would
 * otherwise walk straight past it. The cursor is the test for "has pulled"
 * because it is the same thing the adapter consults, and it is read through
 * the shared predicate so the two cannot drift apart.
 */
export function assertReportUnchangedOncePulled({
  existing,
  incoming,
}: {
  existing: Pick<IngestionSource, "parserConfig" | "pollerCursor">;
  incoming: Record<string, unknown>;
}): ReportImmutabilityVerdict {
  const stored = (existing.parserConfig as Record<string, unknown>) ?? {};
  const storedReport = stored.report;
  if (typeof storedReport !== "string") return REPORT_UNAFFECTED;
  if (incoming.report === storedReport) return REPORT_UNAFFECTED;

  // The one permission this guard grants on the strength of something that
  // can change while it is being granted. Everything above holds whatever the
  // puller does next: a stored config with no report has none to protect, and
  // an unchanged report is not the edit that breaks the invariant. This branch
  // is different — it says yes *because* the column was empty a moment ago,
  // and the caller has to keep it empty all the way to the write.
  if (!hasPollerCursor(existing.pollerCursor)) return CURSOR_MUST_NOT_MOVE;

  // An omitted report is still refused — `data.parserConfig` replaces the
  // stored JSON wholesale, so letting it through would delete the report
  // rather than preserve it, and the source would come back up configured for
  // neither. But it is not the same mistake as asking for the other report,
  // and telling a caller they changed something they never sent is how a
  // serialization bug gets read as a deliberate edit.
  if (incoming.report === undefined) {
    const missing =
      `This source is configured for its ${storedReport} report, and has ` +
      "already pulled it. An update that replaces the configuration has to " +
      "carry the same report value rather than omit it.";
    throw new ValidationError(missing, { meta: { formErrors: [missing] } });
  }

  const complaint =
    `This source has already pulled its ${storedReport} report. ` +
    "Changing the report would record the same spend a second time under " +
    "the other report, so it is fixed once a source has run. Archive this " +
    "source and create a new one to switch reports.";
  throw new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}

async function syncPullProcessBestEffort({
  prisma,
  source,
}: {
  prisma: PrismaClient;
  source: IngestionSource;
}): Promise<void> {
  try {
    await syncIngestionPullSource({
      prisma,
      commands: getApp().commands.ingestionPull,
      source,
    });
  } catch (error) {
    logger.error(
      { sourceId: source.id, error },
      "Failed to sync ingestion pull process; boot reconciliation will retry",
    );
  }
}

/**
 * The trace destination must be a live project of the source's own
 * organization: it decides where routed conversations (customer-visible
 * data) land, and a stray id would write one tenant's conversations into
 * another tenant's project. Mirrors `assertTraceProjectBelongsToOrg` on the
 * virtual-key path (virtualKey.authz.ts) — the puller writes with a
 * service-level Prisma client, so this write-time check is the only gate.
 * ADR-088 v7, Decision 9.
 */
async function assertTraceDestinationIsOwnLiveProject({
  prisma,
  organizationId,
  traceProjectId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  traceProjectId: string | null | undefined;
}): Promise<void> {
  if (!traceProjectId) return;
  const project = await prisma.project.findFirst({
    where: {
      id: traceProjectId,
      archivedAt: null,
      team: { organizationId },
    },
    select: { id: true },
  });
  if (!project) {
    // Without meta.formErrors the presentation layer shows the generic
    // "Check your input" copy and this sentence never reaches the customer
    // (see assertPullSchedule above for the same trap).
    const complaint =
      "Trace destination must be an active project of this organization.";
    throw new ValidationError(complaint, {
      meta: { formErrors: [complaint] },
    });
  }
}

export class IngestionSourceService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): IngestionSourceService {
    return new IngestionSourceService(prisma);
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async list(organizationId: string): Promise<IngestionSource[]> {
    return this.prisma.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
    });
  }

  /**
   * Of the trace destinations these sources point at, the ones that are
   * still live projects of this organization — the same three conditions
   * {@link assertTraceDestinationIsOwnLiveProject} writes under and the
   * puller re-checks at every run.
   *
   * The presentation layer needs the complement: a destination missing from
   * this set has stopped routing, and an admin has to be told that rather
   * than shown an empty picker. It cannot work that out from the project
   * list it already has, because a project outside the reader's own teams is
   * also absent from that list and is not archived at all.
   *
   * One query for the whole page, keyed on the ids actually in use, so
   * listing sources never becomes a per-row lookup.
   */
  async liveTraceProjectIds(
    sources: Array<{ traceProjectId: string | null }>,
    organizationId: string,
  ): Promise<Set<string>> {
    const wanted = [
      ...new Set(
        sources
          .map((s) => s.traceProjectId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (wanted.length === 0) return new Set();
    const live = await this.prisma.project.findMany({
      where: {
        id: { in: wanted },
        archivedAt: null,
        team: { organizationId },
      },
      select: { id: true },
    });
    return new Set(live.map((p) => p.id));
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<IngestionSource | null> {
    const row = await this.prisma.ingestionSource.findUnique({ where: { id } });
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  /**
   * `findById`, for the mutations that cannot proceed without the row.
   *
   * Which org asked is a debugging detail — it goes to the log, not into an
   * error a customer reads (see {@link IngestionSourceNotFoundError}).
   */
  private async requireById(
    id: string,
    organizationId: string,
  ): Promise<IngestionSource> {
    const existing = await this.findById(id, organizationId);
    if (!existing) {
      logger.warn(
        { sourceId: id, organizationId },
        "IngestionSource not found for organization",
      );
      throw new IngestionSourceNotFoundError(id);
    }
    return existing;
  }

  /**
   * Resolve a raw ingestSecret to its IngestionSource row. Used by the
   * push-mode receivers (/api/ingest/otel, /api/ingest/webhook) at the
   * top of every request. Returns null on miss — receivers should
   * respond 401.
   *
   * Honours the rotation grace window: if `parserConfig._rotation`
   * carries the prior hash with `expiresAt > now`, both hashes match
   * the same source.
   */
  async findByIngestSecret(rawSecret: string): Promise<IngestionSource | null> {
    const candidateHash = hashIngestSecret(rawSecret);
    const direct = await this.prisma.ingestionSource.findFirst({
      where: { ingestSecretHash: candidateHash, archivedAt: null },
    });
    if (direct) return direct;
    // Rotation grace path: scan only sources where parserConfig has a
    // `_rotation` slot (Prisma JSON `path` filter). We avoid $queryRaw
    // because dbMultiTenancyProtection rejects raw queries (no model
    // context to authorise against). For typical orgs the rotating
    // set is tiny (hours-scale grace window) so the in-app hash check
    // on each is negligible.
    const candidates = await this.prisma.ingestionSource.findMany({
      where: {
        archivedAt: null,
        parserConfig: {
          path: ["_rotation", "priorHash"],
          equals: candidateHash,
        },
      },
    });
    const now = Date.now();
    for (const candidate of candidates) {
      const rotation =
        ((candidate.parserConfig as Record<string, unknown>)?._rotation as
          | { priorHash?: string; expiresAt?: number }
          | undefined) ?? undefined;
      if (
        rotation?.priorHash === candidateHash &&
        typeof rotation.expiresAt === "number" &&
        rotation.expiresAt > now
      ) {
        return candidate;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------

  async createSource(
    input: CreateIngestionSourceInput,
  ): Promise<CreatedIngestionSource> {
    if (input.pullSchedule !== null && input.pullSchedule !== undefined) {
      assertPullSchedule(input.pullSchedule);
    }
    // Defense-in-depth plan gate. Non-enterprise orgs can create up to
    // NON_ENTERPRISE_INGESTION_SOURCE_CAP active sources (composer
    // separately restricts source TYPE to otel_generic for them). This
    // catches non-tRPC callers (background workers, webhook adapters)
    // so the cap can't be bypassed regardless of entry point. Enterprise
    // orgs are unbounded. Spec: specs/ai-gateway/license-gate-governance.feature.
    const plan = await getApp().planProvider.getActivePlan({
      organizationId: input.organizationId,
    });
    if (!isEnterpriseTier(plan.type)) {
      const existing = await this.prisma.ingestionSource.count({
        where: { organizationId: input.organizationId, archivedAt: null },
      });
      if (existing >= NON_ENTERPRISE_INGESTION_SOURCE_CAP) {
        throw new IngestionSourceCapReachedError(
          NON_ENTERPRISE_INGESTION_SOURCE_CAP,
        );
      }
    }

    if (!SUPPORTED_SOURCE_TYPES.includes(input.sourceType)) {
      // The router's zod enum catches this before the service sees it; a
      // worker or webhook adapter's does not, and that is the caller this
      // guard exists for. Naming the allowed values is the entire remedy, so
      // it must not arrive as "Something went wrong — we've been notified".
      throw unsupportedValue({
        field: "sourceType",
        value: input.sourceType,
        allowed: SUPPORTED_SOURCE_TYPES,
      });
    }

    // Lazy-ensure the hidden Governance Project on first source mint —
    // every IngestionSource for an org routes its events through this
    // single internal Project. Idempotent. Single helper, no duplicate
    // lazy-create logic anywhere else (master_orchestrator constraint).
    await ensureHiddenGovernanceProject(this.prisma, input.organizationId);

    const ingestSecret = generateIngestSecret();
    const ingestSecretHash = hashIngestSecret(ingestSecret);

    // Phase 10 carryover — the schema has `parserConfig` but no
    // `pullConfig` column; the puller worker actually reads
    // `source.parserConfig` as the adapter config (see
    // pullerWorker.ts:89 `const pullConfig = source.parserConfig`).
    // The earlier service shape exposed both inputs as if they were
    // separate columns, which 500'd at create time (Ariana caught
    // this on the OTLP-ingestion-source dogfood). Merge here so
    // callers can keep using either field name without a schema
    // change. `parserConfig` wins on key conflicts (it's the
    // canonical input for push-mode sources); `pullConfig` data
    // fills in for pull-mode adapters.
    const requestedParserConfig = {
      ...(input.pullConfig ?? {}),
      ...(input.parserConfig ?? {}),
    };
    assertPullDestinationAllowed(requestedParserConfig);
    await assertTraceDestinationIsOwnLiveProject({
      prisma: this.prisma,
      organizationId: input.organizationId,
      traceProjectId: input.traceProjectId,
    });
    const mergedParserConfig = encryptParserConfigCredentials(
      requestedParserConfig,
    )!;
    const source = await this.prisma.ingestionSource.create({
      data: {
        organizationId: input.organizationId,
        teamId: input.teamId ?? null,
        sourceType: input.sourceType,
        name: input.name,
        description: input.description ?? null,
        ingestSecretHash,
        parserConfig: mergedParserConfig as Prisma.InputJsonValue,
        pullSchedule: input.pullSchedule ?? null,
        traceProjectId: input.traceProjectId ?? null,
        status: "awaiting_first_event",
        createdById: input.actorUserId,
      },
    });
    if (source.pullSchedule) {
      await syncPullProcessBestEffort({ prisma: this.prisma, source });
    }
    return { source, ingestSecret };
  }

  async updateSource(
    input: UpdateIngestionSourceInput,
  ): Promise<IngestionSource> {
    const existing = await this.requireById(input.id, input.organizationId);
    if (input.pullSchedule !== null && input.pullSchedule !== undefined) {
      assertPullSchedule(input.pullSchedule);
    }
    const data: Prisma.IngestionSourceUpdateInput = {};
    // Set by the report-immutability guard below, and read at the write. It
    // lives out here because the guard only runs on the parserConfig path
    // while the write is shared by every path.
    let cursorMustNotMove = false;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.parserConfig !== undefined) {
      // A client never handles the stored secret, in either direction. It is
      // redacted on the way out, so an update that does not carry a fresh one
      // is saying "leave it alone" rather than "clear it" — carry the stored
      // envelope across, or a routine rename would silently break the source.
      //
      // The mirror of that: an envelope arriving FROM a client is refused. It
      // could only have come from a copy of a response we no longer send, and
      // honouring it would let a caller keep a secret it cannot read while
      // pointing the source somewhere new. Rotating means sending a new secret.
      const incoming = { ...input.parserConfig };
      if (isEncryptedCredentials(incoming.credentials)) {
        throw new ValidationError(
          "Credentials cannot be submitted in their stored form. Re-enter the secret to change this source, or omit it to keep the current one.",
        );
      }
      // Carry across every key a client is never shown. `credentials` is one;
      // the `_`-prefixed internals are the rest, and `_rotation` is the one
      // that bites — it holds the previous secret's hash for the 24h window
      // after a rotation, so an edit landing inside that window used to cut the
      // grace short and start rejecting upstream clients that had not rolled
      // over yet. A client cannot send back what it never received, so absent
      // must mean "unchanged" for all of them, not just the secret.
      const stored = (existing.parserConfig as Record<string, unknown>) ?? {};
      for (const key of Object.keys(stored)) {
        const hiddenFromClients = key === "credentials" || key.startsWith("_");
        if (hiddenFromClients && incoming[key] === undefined) {
          incoming[key] = stored[key];
        }
      }
      ({ cursorMustNotMove } = assertReportUnchangedOncePulled({
        existing,
        incoming,
      }));
      assertPullDestinationAllowed(incoming);
      data.parserConfig = encryptParserConfigCredentials(
        incoming,
      ) as Prisma.InputJsonValue;
    }
    if (input.status !== undefined) data.status = input.status;
    if (input.pullSchedule !== undefined)
      data.pullSchedule = input.pullSchedule;
    if (input.traceProjectId !== undefined) {
      // Undefined stays put; null stops routing; a named destination is
      // re-validated exactly the way create validates it (the virtual-key
      // editing contract — ADR-088 v7, Decision 9).
      await assertTraceDestinationIsOwnLiveProject({
        prisma: this.prisma,
        organizationId: input.organizationId,
        traceProjectId: input.traceProjectId,
      });
      data.traceProjectId = input.traceProjectId;
    }
    if (input.teamId !== undefined) {
      data.team = input.teamId
        ? { connect: { id: input.teamId } }
        : { disconnect: true };
    }
    const source = cursorMustNotMove
      ? await this.updateHoldingTheCursorStill({ existing, data })
      : await this.prisma.ingestionSource.update({
          where: { id: existing.id },
          data,
        });
    if (existing.pullSchedule !== null || source.pullSchedule !== null) {
      await syncPullProcessBestEffort({ prisma: this.prisma, source });
    }
    return source;
  }

  /**
   * The same update, refused rather than applied if the poller cursor moved
   * since the guard read it.
   *
   * `assertReportUnchangedOncePulled` clears a report change by observing that
   * the source has no cursor yet. Between that read and this write a pull run
   * can complete and record one, and the update then lands on a source that
   * has pulled — the state the guard refuses when it can see it, reached by
   * arriving a few milliseconds late. Nothing about the result looks wrong
   * afterwards: no row collides, no constraint fires, and the same spend is
   * simply counted twice, once under each report.
   *
   * Two things close it, and both are needed. The `updateMany` carries the
   * cursor the decision was made on in its `where`, so a cursor written in the
   * gap makes it match nothing and the transaction is abandoned with the row
   * untouched. And because it is a write rather than a read, Postgres holds a
   * row lock from that point until commit, so a pull run arriving after the
   * check waits instead of interleaving with the update that follows. A plain
   * `SELECT` inside the transaction would give neither: under READ COMMITTED
   * it takes no lock, and the puller would write straight past it.
   *
   * The cost is one extra statement, paid only on this path — a report change
   * on a source that has never pulled, which happens while an admin is fixing
   * a source they just created. Every other edit takes the unpinned write,
   * because pinning them would fail a routine rename for the sole reason that
   * a scheduled pull happened to land in the same second.
   *
   * `Prisma.AnyNull` rather than `null`: the column is `Json?` and the two
   * writers disagree about which null they store — the projection repository
   * writes `Prisma.JsonNull` (a JSON null) while a never-written column holds
   * SQL NULL. Both read back as JS `null`, so a pin derived from the read has
   * to match either, or the guard's most common case — a source that has never
   * pulled at all — would conflict with itself.
   */
  private async updateHoldingTheCursorStill({
    existing,
    data,
  }: {
    existing: IngestionSource;
    data: Prisma.IngestionSourceUpdateInput;
  }): Promise<IngestionSource> {
    return await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ingestionSource.updateMany({
        where: {
          id: existing.id,
          pollerCursor:
            existing.pollerCursor === null
              ? { equals: Prisma.AnyNull }
              : { equals: existing.pollerCursor as Prisma.InputJsonValue },
        },
        data: { updatedAt: new Date() },
      });
      if (count === 0) {
        const raced =
          "This source started pulling while the change was being saved, " +
          "and the report can no longer be changed. Reload the source to " +
          "see its current configuration.";
        throw new ValidationError(raced, { meta: { formErrors: [raced] } });
      }
      return await tx.ingestionSource.update({
        where: { id: existing.id },
        data,
      });
    });
  }

  /**
   * Rotate the ingestSecret with a 24h grace window. The new secret is
   * returned exactly once; the old hash stays valid until grace expires
   * so the upstream operator has time to paste in the new value.
   */
  async rotateSecret(
    id: string,
    organizationId: string,
  ): Promise<{ source: IngestionSource; ingestSecret: string }> {
    const existing = await this.requireById(id, organizationId);
    const newSecret = generateIngestSecret();
    const newHash = hashIngestSecret(newSecret);
    const priorParser =
      (existing.parserConfig as Record<string, unknown>) ?? {};
    const merged = encryptParserConfigCredentials({
      ...priorParser,
      _rotation: {
        priorHash: existing.ingestSecretHash,
        expiresAt: Date.now() + ROTATION_GRACE_MS,
      },
    })!;
    const source = await this.prisma.ingestionSource.update({
      where: { id: existing.id },
      data: {
        ingestSecretHash: newHash,
        parserConfig: merged as Prisma.InputJsonValue,
      },
    });
    return { source, ingestSecret: newSecret };
  }

  async archive(id: string, organizationId: string): Promise<IngestionSource> {
    const existing = await this.requireById(id, organizationId);
    const source = await this.prisma.ingestionSource.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: "disabled" },
    });
    if (source.pullSchedule) {
      await syncPullProcessBestEffort({ prisma: this.prisma, source });
    }
    return source;
  }

  /**
   * Stamp lastEventAt + flip status to 'active' on the first event
   * received from a source. Called by every receiver (push + pull) at
   * the top of every successful event handle.
   */
  async recordEventReceived(id: string): Promise<void> {
    await this.prisma.ingestionSource.update({
      where: { id },
      data: {
        lastEventAt: new Date(),
        status: "active",
      },
    });
  }
}

// ---------------------------------------------------------------------
// Secret helpers (also exported for the receiver layer)
// ---------------------------------------------------------------------

export function generateIngestSecret(): string {
  return `lw_is_${randomBytes(32).toString("base64url")}`;
}

export function hashIngestSecret(rawSecret: string): string {
  // Pepper-prefix prevents rainbow-table style attacks on the hash
  // column. Reuses the same per-deployment pepper as VirtualKey
  // hashing (LW_VIRTUAL_KEY_PEPPER) so secret-rotation across all
  // governance secrets is a single env var bump.
  const pepper = env.LW_VIRTUAL_KEY_PEPPER ?? "";
  return createHash("sha256")
    .update(`${pepper}::${rawSecret}`)
    .digest("base64url");
}
