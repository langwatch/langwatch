import { NextResponse, type NextRequest } from "next/server";
import {
  type IExportTraceServiceRequest,
  // @ts-ignore
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { prisma } from "../../../../../server/db";
import { openTelemetryTraceRequestToTracesForCollection } from "../../../../../server/tracer/otel.traces";
import * as Sentry from "@sentry/nextjs";
import * as crypto from "crypto";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "../../../../../server/background/workers/collectorWorker";
import { spanIngestionService } from "../../../../../server/features/span-ingestion/services/spanIngestionService";
import { createLogger } from "../../../../../utils/logger";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";
import { withAppRouterTracer } from "../../../../../middleware/app-router-tracer";
import { getLangWatchTracer } from "langwatch";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { getCurrentMonthMessagesCount } from "../../../../../server/api/routers/limits";
import { dependencies } from "../../../../../injection/dependencies.server";

const tracer = getLangWatchTracer("langwatch.otel.traces");
const logger = createLogger("langwatch:otel:v1:traces");

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

async function handleTracesRequest(req: NextRequest) {
  return await tracer.withActiveSpan(
    "TracesV1.handleTracesRequest",
    { kind: SpanKind.SERVER },
    async (span) => {
      const xAuthToken = req.headers.get("x-auth-token");
      const authHeader = req.headers.get("authorization");
      const contentType = req.headers.get("content-type");

      const authToken =
        xAuthToken ??
        (authHeader?.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7)
          : null);

      if (!authToken) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "No auth token provided.",
        });

        return NextResponse.json(
          {
            message:
              "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
          },
          { status: 401 },
        );
      }

      const project = await prisma.project.findUnique({
        where: { apiKey: authToken },
        include: {
          team: true,
        },
      });

      if (!project) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid auth token.",
        });

        return NextResponse.json(
          { message: "Invalid auth token." },
          { status: 401 },
        );
      }

      try {
        const currentMonthMessagesCount = await getCurrentMonthMessagesCount(
          [project.id],
          project.team.organizationId,
        );

        const activePlan = await dependencies.subscriptionHandler.getActivePlan(
          project.team.organizationId,
        );

        if (currentMonthMessagesCount >= activePlan.maxMessagesPerMonth) {
          if (dependencies.planLimits) {
            try {
              await dependencies.planLimits(
                project.team.organizationId,
                activePlan.name ?? "free",
              );
            } catch (error) {
              logger.error(
                { error, projectId: project.id },
                "Error sending plan limit notification",
              );
            }
          }
          logger.info(
            {
              projectId: project.id,
              currentMonthMessagesCount,
              activePlanName: activePlan.name,
              maxMessagesPerMonth: activePlan.maxMessagesPerMonth,
            },
            "Project has reached plan limit",
          );

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Plan limit reached.",
          });

          return NextResponse.json(
            {
              message: `ERR_PLAN_LIMIT: You have reached the monthly limit of ${activePlan.maxMessagesPerMonth} messages, please go to LangWatch dashboard to verify your plan.`,
            },
            { status: 429 },
          );
        }
      } catch (error) {
        logger.error(
          { error, projectId: project.id },
          "Error getting current month messages count",
        );
        Sentry.captureException(
          new Error("Error getting current month messages count"),
          {
            extra: { projectId: project.id, zodError: error },
          },
        );
      }

      span.setAttribute("langwatch.project.id", project.id);

      const body = await req.arrayBuffer();
      let traceRequest: IExportTraceServiceRequest;
      try {
        if (contentType === "application/json") {
          traceRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          traceRequest = traceRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          traceRequest = traceRequestType.decode(
            new Uint8Array(traceRequestType.encode(json).finish()),
          );
          if (
            !traceRequest.resourceSpans ||
            traceRequest.resourceSpans.length === 0
          ) {
            throw new Error("Spans are empty, likely an invalid format");
          }
        } catch (jsonError) {
          logger.error(
            {
              error: jsonError,
              traceRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing traces",
          );
          Sentry.captureException(error, {
            extra: {
              projectId: project.id,
              traceRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          return NextResponse.json(
            { error: "Failed to parse traces" },
            { status: 400 },
          );
        }
      }

      const tracesForCollection =
        await openTelemetryTraceRequestToTracesForCollection(traceRequest);
      const clickHouseTasks: Promise<void>[] = [];

      const promises = await tracer.withActiveSpan(
        "TracesV1.duplicateTracesCheck",
        { kind: SpanKind.INTERNAL },
        async () => {
          const promises: Promise<void>[] = [];
          for (const traceForCollection of tracesForCollection) {
            const paramsMD5 = crypto
              .createHash("md5")
              .update(JSON.stringify({ ...traceForCollection }))
              .digest("hex");
            const existingTrace = await fetchExistingMD5s(
              traceForCollection.traceId,
              project.id,
            );
            if (existingTrace?.indexing_md5s?.includes(paramsMD5)) {
              continue;
            }

            logger.info(
              {
                traceId: traceForCollection.traceId,
                traceRequestSizeMb: parseFloat(
                  (
                    Buffer.from(JSON.stringify(traceRequest)).length /
                    (1024 * 1024)
                  ).toFixed(3),
                ),
                traceRequestSpansCount:
                  traceRequest.resourceSpans?.reduce(
                    (acc, resourceSpan) =>
                      acc + (resourceSpan?.scopeSpans?.length ?? 0),
                    0,
                  ) ?? 0,
              },
              "collecting traces",
            );

            if (project.featureClickHouse) {
              clickHouseTasks.push(
                spanIngestionService.consumeSpans(
                  project.id,
                  traceForCollection,
                  traceRequest,
                ),
              );
            }

            promises.push(
              scheduleTraceCollectionWithFallback({
                ...traceForCollection,
                projectId: project.id,
                existingTrace,
                paramsMD5,
                expectedOutput: void 0,
                evaluations: void 0,
                collectedAt: Date.now(),
              }),
            );
          }

          return promises;
        },
      );

      if (promises.length === 0) {
        if (clickHouseTasks.length > 0) {
          try {
            await Promise.allSettled(clickHouseTasks);
          } catch { /* ignore, errors non-blocking and caught by tracing layer */}
        }
        return NextResponse.json({ message: "No changes" });
      }

      await tracer.withActiveSpan(
        "TracesV1.enqueueTraces",
        { kind: SpanKind.PRODUCER },
        async () => {
          await Promise.all(promises);
        },
      );

      if (clickHouseTasks.length > 0) {
        try {
          await Promise.allSettled(clickHouseTasks);
        } catch { /* ignore, errors non-blocking and caught by tracing layer */}
      }

      return NextResponse.json({ message: "Trace received successfully." });
    },
  );
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterTracer("otel.v1.traces")(withAppRouterLogger(handleTracesRequest));
