/**
 * A stand-in for the running stack the dashboards demo sends to: it keeps what each project's
 * key posts through the doors, and answers the read APIs and the seed's database reads from that.
 * Nothing here is the product; it is the network boundary, held in memory.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { z } from "zod";

const OTLP_TRACES = "/api/otel/v1/traces";
const SEARCH = "/api/traces/search";
const QUERY = "/api/v1/query";

/** The reads and find-or-create calls a re-run repeats without adding anything. */
const READ_PATHS = new Set([SEARCH, QUERY, "/api/experiment/init"]);

const otlpAttributeSchema = z.object({
  key: z.string(),
  value: z.looseObject({ stringValue: z.string().optional() }),
});
const otlpSpanSchema = z.looseObject({
  traceId: z.string(),
  startTimeUnixNano: z.string(),
  attributes: z.array(otlpAttributeSchema),
});
const otlpTracesSchema = z.object({
  resourceSpans: z.array(
    z.looseObject({ scopeSpans: z.array(z.looseObject({ spans: z.array(otlpSpanSchema) })) }),
  ),
});
const otlpLogsSchema = z.object({
  resourceLogs: z.array(
    z.looseObject({
      scopeLogs: z.array(
        z.looseObject({
          logRecords: z.array(
            z.looseObject({ timeUnixNano: z.string(), attributes: z.array(otlpAttributeSchema) }),
          ),
        }),
      ),
    }),
  ),
});
const scenarioEventSchema = z.looseObject({
  type: z.string(),
  scenarioRunId: z.string(),
  timestamp: z.number(),
});
const spendSchema = z.object({
  records: z.array(
    z.object({
      command: z.string(),
      payload: z.looseObject({
        gateway_request_id: z.string(),
        virtual_key_id: z.string(),
        occurred_at: z.number(),
      }),
    }),
  ),
});
const searchSchema = z.looseObject({
  startDate: z.number(),
  endDate: z.number(),
  pageSize: z.number(),
  filter: z.string().optional(),
  scrollId: z.string().optional(),
});
const querySchema = z.object({ sql: z.string() });
const QUERY_SHAPE =
  /^SELECT DISTINCT (\w+) FROM (\w+)(?: WHERE .+?)? ORDER BY \w+ LIMIT (\d+) OFFSET (\d+)$/;

/** One call the seed made, as the stack received it. */
export interface DemoStackRequest {
  method: string;
  path: string;
  /** The project key it was sent with. */
  apiKey: string;
  body: unknown;
}

/** What one project holds, by the id the seed asks for before it sends. */
class Holdings {
  /** Trace id to whether it is one of Langy's turns, and when its first span started. */
  readonly traces = new Map<string, { isLangy: boolean; startedAt: number }>();
  readonly sessions = new Map<string, number>();
  readonly experimentRuns = new Set<string>();
  readonly finishedScenarioRuns = new Map<string, number>();
  /** Gateway request id to the virtual key and time of its outcome. */
  readonly settledSpend = new Map<string, { virtualKeyId: string; occurredAt: number }>();
  readonly virtualKeys: { id: string; name: string }[] = [];
  readonly promptVersions = new Map<string, number>();
  readonly reviewedTraces = new Set<string>();
}

const millis = (nanos: string) => Number(nanos.slice(0, -6));
const attributeOf = (attributes: z.infer<typeof otlpAttributeSchema>[], key: string) =>
  attributes.find((attribute) => attribute.key === key)?.value.stringValue;

export class DemoStack {
  readonly requests: DemoStackRequest[] = [];
  /** Ids a door received a second time: what a re-run must never cause. */
  readonly repeats: string[] = [];
  /** Paths that answer this status and body instead of taking the request. */
  readonly answers = new Map<string, { status: number; body: string }>();
  /** The dates the seed wrote into the database, in epoch milliseconds, by table and row. */
  readonly datedRows = {
    promptVersions: new Map<string, number>(),
    annotations: new Map<string, number>(),
    queueItems: new Map<string, { createdAt: number; doneAt: number | undefined }>(),
  };
  private readonly projects = new Map<string, Holdings>();

  /** `projectKeys` names each project's key by its id, as the stack's own database would. */
  constructor(private readonly projectKeys: Readonly<Record<string, string>>) {}

  /** What the project with this key holds. */
  holdings(apiKey: string): Holdings {
    const held = this.projects.get(apiKey) ?? new Holdings();
    this.projects.set(apiKey, held);
    return held;
  }

  /** The calls that add something to the stack, leaving out the reads a re-run repeats. */
  writes({ since = 0 }: { since?: number } = {}): DemoStackRequest[] {
    return this.requests
      .slice(since)
      .filter(({ method, path }) => method !== "GET" && !READ_PATHS.has(path));
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const apiKey = new Headers(init?.headers).get("X-Auth-Token") ?? "";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path: url.pathname, apiKey, body });
    const scripted = this.answers.get(url.pathname);
    if (scripted) return new Response(scripted.body, { status: scripted.status });

    return Response.json(this.answer({ method, path: url.pathname, apiKey, body }));
  };

  /** The database as the seed reads and dates it, answering from what the doors received. */
  prisma() {
    const heldBy = (projectId: string) => this.holdings(this.projectKeys[projectId] ?? "");
    return prismaDouble({
      project: {
        findUniqueOrThrow: async () => ({ team: { organizationId: "langy-mirror-organization" } }),
      },
      llmPromptConfig: {
        findFirst: async (args: unknown) => {
          const { where } = z
            .object({ where: z.looseObject({ projectId: z.string(), handle: z.string() }) })
            .parse(args);
          const handle = where.handle.slice(where.projectId.length + 1);
          const made = heldBy(where.projectId).promptVersions.get(handle) ?? 0;
          return {
            id: handle,
            versions: Array.from({ length: made }, (_, version) => ({ version })),
          };
        },
      },
      llmPromptConfigVersion: {
        findMany: async (args: unknown) => {
          const { where } = z
            .object({
              where: z.looseObject({
                projectId: z.string(),
                config: z.object({ handle: z.string() }),
              }),
            })
            .parse(args);
          const handle = where.config.handle.slice(where.projectId.length + 1);
          const made = heldBy(where.projectId).promptVersions.get(handle) ?? 0;
          return Array.from({ length: made }, (_, version) => ({ id: `${handle}#${version}` }));
        },
        updateMany: async (args: unknown) => {
          const { where, data } = z
            .object({
              where: z.object({ id: z.string(), projectId: z.string() }),
              data: z.object({ createdAt: z.date() }),
            })
            .parse(args);
          this.datedRows.promptVersions.set(
            `${where.projectId}:${where.id}`,
            data.createdAt.getTime(),
          );
          return { count: 1 };
        },
      },
      annotation: {
        findMany: async (args: unknown) => {
          const { where } = z
            .object({
              where: z.object({
                projectId: z.string(),
                traceId: z.object({ in: z.array(z.string()) }),
              }),
            })
            .parse(args);
          const reviewed = heldBy(where.projectId).reviewedTraces;
          return where.traceId.in.filter((id) => reviewed.has(id)).map((traceId) => ({ traceId }));
        },
        updateMany: async (args: unknown) => {
          const { where, data } = z
            .object({
              where: z.object({ projectId: z.string(), traceId: z.string() }),
              data: z.object({ createdAt: z.date() }),
            })
            .parse(args);
          this.datedRows.annotations.set(
            `${where.projectId}:${where.traceId}`,
            data.createdAt.getTime(),
          );
          return { count: 1 };
        },
      },
      annotationQueue: {
        upsert: async (args: unknown) => {
          const { create } = z.object({ create: z.looseObject({ id: z.string() }) }).parse(args);
          return { id: create.id };
        },
      },
      annotationQueueItem: {
        upsert: async (args: unknown) => {
          const { create } = z
            .object({
              create: z.looseObject({
                traceId: z.string(),
                projectId: z.string(),
                createdAt: z.date(),
                doneAt: z.date().nullable(),
              }),
            })
            .parse(args);
          this.datedRows.queueItems.set(`${create.projectId}:${create.traceId}`, {
            createdAt: create.createdAt.getTime(),
            doneAt: create.doneAt?.getTime(),
          });
          return { id: create.traceId };
        },
      },
    });
  }

  private answer({ method, path, apiKey, body }: DemoStackRequest): unknown {
    const held = this.holdings(apiKey);
    if (path === SEARCH) return this.search({ held, body });
    if (path === QUERY) return this.query({ held, body });
    if (path === OTLP_TRACES) return this.keepTraces({ held, body });
    if (path === "/api/otel/v1/logs") return this.keepSessions({ held, body });
    if (path === "/api/scenario-events") return this.keepScenarioEvent({ held, body });
    if (path === "/api/evaluations/batch/log_results") {
      this.keep({
        ids: held.experimentRuns,
        id: z.looseObject({ run_id: z.string() }).parse(body).run_id,
      });
    }
    if (path === "/api/internal/gateway/spend-commands") return this.keepSpend({ body });
    if (path === "/api/gateway/v1/virtual-keys") return this.virtualKeys({ held, method, body });
    if (path.startsWith("/api/prompts")) return this.keepPromptVersion({ held, path, body });
    if (path.startsWith("/api/annotations/trace/")) {
      this.keep({ ids: held.reviewedTraces, id: path.slice("/api/annotations/trace/".length) });
    }
    return {};
  }

  /** Adds an id a door received, noting it when the door already held it. */
  private keep({ ids, id }: { ids: Set<string>; id: string }): void {
    if (ids.has(id)) this.repeats.push(id);
    ids.add(id);
  }

  private keepTraces({ held, body }: { held: Holdings; body: unknown }): unknown {
    const spans = otlpTracesSchema
      .parse(body)
      .resourceSpans.flatMap(({ scopeSpans }) => scopeSpans.flatMap((scope) => scope.spans));
    for (const traceId of new Set(spans.map((span) => span.traceId))) {
      const own = spans.filter((span) => span.traceId === traceId);
      if (held.traces.has(traceId)) this.repeats.push(traceId);
      held.traces.set(traceId, {
        isLangy: own.some((span) => attributeOf(span.attributes, "langwatch.origin") === "langy"),
        startedAt: Math.min(...own.map((span) => millis(span.startTimeUnixNano))),
      });
    }
    return {};
  }

  private keepSessions({ held, body }: { held: Holdings; body: unknown }): unknown {
    const records = otlpLogsSchema
      .parse(body)
      .resourceLogs.flatMap(({ scopeLogs }) => scopeLogs.flatMap((scope) => scope.logRecords));
    const sessionId = records
      .map((record) => attributeOf(record.attributes, "session.id"))
      .find((id) => id !== undefined);
    if (sessionId === undefined) return {};
    if (held.sessions.has(sessionId)) this.repeats.push(sessionId);
    held.sessions.set(
      sessionId,
      Math.min(...records.map(({ timeUnixNano }) => millis(timeUnixNano))),
    );
    return {};
  }

  private keepScenarioEvent({ held, body }: { held: Holdings; body: unknown }): unknown {
    const event = scenarioEventSchema.parse(body);
    if (event.type !== "SCENARIO_RUN_FINISHED") return {};
    if (held.finishedScenarioRuns.has(event.scenarioRunId)) this.repeats.push(event.scenarioRunId);
    held.finishedScenarioRuns.set(event.scenarioRunId, event.timestamp);
    return {};
  }

  /** Spend is signed by the gateway, not a project key, so it is kept by the project it names. */
  private keepSpend({ body }: { body: unknown }): unknown {
    for (const { command, payload } of spendSchema.parse(body).records) {
      if (command === "admitSpend") continue;
      const { project_id: projectId } = z.looseObject({ project_id: z.string() }).parse(payload);
      const held = this.holdings(this.projectKeys[projectId] ?? "");
      if (held.settledSpend.has(payload.gateway_request_id)) {
        this.repeats.push(payload.gateway_request_id);
      }
      held.settledSpend.set(payload.gateway_request_id, {
        virtualKeyId: payload.virtual_key_id,
        occurredAt: payload.occurred_at,
      });
    }
    return {};
  }

  private virtualKeys({
    held,
    method,
    body,
  }: {
    held: Holdings;
    method: string;
    body: unknown;
  }): unknown {
    if (method === "GET") return { data: held.virtualKeys };
    const { name } = z.looseObject({ name: z.string() }).parse(body);
    const key = { id: `vk_${name}`, name };
    held.virtualKeys.push(key);
    return { virtual_key: key };
  }

  private keepPromptVersion({
    held,
    path,
    body,
  }: {
    held: Holdings;
    path: string;
    body: unknown;
  }): unknown {
    const created = z.looseObject({ handle: z.string().optional() }).parse(body).handle;
    const handle = created ?? path.slice("/api/prompts/".length);
    held.promptVersions.set(handle, (held.promptVersions.get(handle) ?? 0) + 1);
    return {};
  }

  /** The trace search over its dates, paged; Langy's turns only when the filter asks. */
  private search({ held, body }: { held: Holdings; body: unknown }): unknown {
    const { startDate, endDate, pageSize, filter, scrollId } = searchSchema.parse(body);
    const wantsLangy = filter === "origin:langy";
    const ids = [...held.traces]
      .filter(([, trace]) => trace.isLangy === wantsLangy)
      .filter(([, trace]) => trace.startedAt >= startDate && trace.startedAt <= endDate)
      .map(([traceId]) => traceId);
    const from = Number(scrollId ?? 0);
    const page = ids.slice(from, from + pageSize);
    return {
      traces: page.map((traceId) => ({ trace_id: traceId })),
      pagination: { scrollId: String(from + page.length) },
    };
  }

  /** The id lists the seed asks the query door for, one page at a time. */
  private query({ held, body }: { held: Holdings; body: unknown }): unknown {
    const [, column, view, limit, offset] = QUERY_SHAPE.exec(querySchema.parse(body).sql) ?? [];
    const lists: Readonly<Record<string, Iterable<string>>> = {
      coding_sessions: held.sessions.keys(),
      experiment_run_results: held.experimentRuns,
      gateway_request_spend: held.settledSpend.keys(),
      simulations: held.finishedScenarioRuns.keys(),
    };
    const ids = view ? lists[view] : undefined;
    if (!column || !ids) throw new Error("the demo stack was asked a query it does not know");
    const rows = [...ids].toSorted().slice(Number(offset), Number(offset) + Number(limit));
    return { rows: rows.map((id) => ({ [column]: id })) };
  }
}
