import superjson from "superjson";
import * as crypto from "node:crypto";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { type NextRequest, NextResponse } from "next/server";
import { notifyPlanLimitReached } from "../../../../../../ee/billing";
import { captureException } from "~/utils/posthogErrorCapture";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";
import { withAppRouterTracer } from "../../../../../middleware/app-router-tracer";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "../../../../../server/background/workers/collectorWorker";
import { prisma } from "../../../../../server/db";
import { SubscriptionHandler } from "../../../../../server/subscriptionHandler";
import { openTelemetryTraceRequestToTracesForCollection } from "../../../../../server/tracer/otel.traces";
import { TraceRequestCollectionService } from "../../../../../server/traces/trace-request-collection.service";
import { getApp } from "../../../../../server/app-layer/app";
import { createLogger } from "../../../../../utils/logger/server";

const tracer = getLangWatchTracer("langwatch.otel.traces");
const logger = createLogger("langwatch:otel:v1:traces");
const traceRequestCollectionService = new TraceRequestCollectionService();

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
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
        const limitResult = await getApp().usage.checkLimit({
          teamId: project.teamId,
        });

        if (limitResult.exceeded) {
          try {
            const activePlan = await SubscriptionHandler.getActivePlan(
              project.team.organizationId,
            );
            await notifyPlanLimitReached({
              organizationId: project.team.organizationId,
              planName: activePlan.name ?? "free",
            });
          } catch (error) {
            logger.error(
              { error, projectId: project.id },
              "Error sending plan limit notification",
            );
          }
          logger.info(
            {
              projectId: project.id,
              currentMonthMessagesCount: limitResult.count,
              activePlanName: limitResult.planName,
              maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
            },
            "Project has reached plan limit",
          );

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Plan limit reached.",
          });

          return NextResponse.json(
            {
              message: `ERR_PLAN_LIMIT: ${limitResult.message}`,
            },
            { status: 429 },
          );
        }
      } catch (error) {
        logger.error(
          { error, projectId: project.id },
          "Error checking trace limit",
        );
        captureException(new Error("Error checking trace limit"), {
          extra: { projectId: project.id, error },
        });
      }

      span.setAttribute("langwatch.project.id", project.id);

      const body = await req.arrayBuffer();

      // Handle empty body gracefully - protobuf decode throws on empty input.
      // OTEL SDKs may send empty requests during shutdown/flush cycles.
      if (body.byteLength === 0) {
        logger.debug("Received empty trace request, ignoring");
        return NextResponse.json({ message: "No traces to process" });
      }

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
          captureException(error, {
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

      // For ClickHouse, ingest raw OTEL spans directly (bypasses otel.traces.ts transformation)
      let clickHouseTask: Promise<void> | null = null;
      if (project.featureEventSourcingTraceIngestion) {
        clickHouseTask = traceRequestCollectionService.handleOtlpTraceRequest(
          project.id,
          traceRequest,
          project.piiRedactionLevel,
        );
      }

      const tracesForCollection =
        await openTelemetryTraceRequestToTracesForCollection(traceRequest);

      const promises = await tracer.withActiveSpan(
        "TracesV1.duplicateTracesCheck",
        { kind: SpanKind.INTERNAL },
        async () => {
          const promises: Promise<void>[] = [];
          for (const traceForCollection of tracesForCollection) {
            if (traceForCollection.spans.length === 0) continue;

            // Fingerprint for deduplication: traceId + span count + first/last span timestamps
            // Much faster than stringifying thousands of spans
            const fingerprint = {
              traceId: traceForCollection.traceId,
              spanCount: traceForCollection.spans.length,
              firstSpanStart: traceForCollection.spans[0]?.timestamps?.started_at,
              lastSpanEnd: traceForCollection.spans[traceForCollection.spans.length - 1]?.timestamps?.finished_at,
            };
            
            const paramsMD5 = crypto
              .createHash("md5")
              .update(JSON.stringify(fingerprint))
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
                  (body.byteLength / (1024 * 1024)).toFixed(3),
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

            promises.push(
              scheduleTraceCollectionWithFallback(
                {
                  ...traceForCollection,
                  projectId: project.id,
                  existingTrace,
                  paramsMD5,
                  expectedOutput: void 0,
                  evaluations: void 0,
                  collectedAt: Date.now(),
                },
                false,
                body.byteLength,
              ),
            );
          }

          return promises;
        },
      );

      if (promises.length === 0) {
        if (clickHouseTask) {
          try {
            await clickHouseTask;
          } catch {
            /* ignore, errors non-blocking and caught by tracing layer */
          }
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

      if (clickHouseTask) {
        try {
          await clickHouseTask;
        } catch {
          /* ignore, errors non-blocking and caught by tracing layer */
        }
      }

      return NextResponse.json({ message: "Trace received successfully." });
    },
  );
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterTracer("langwatch.otel.v1.traces")(
  withAppRouterLogger(handleTracesRequest),
);
