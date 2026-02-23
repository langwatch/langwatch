import superjson from "superjson";
import crypto from "node:crypto";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { type NextRequest, NextResponse } from "next/server";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "~/server/background/workers/collectorWorker";
import { openTelemetryMetricsRequestToTracesForCollection } from "~/server/tracer/otel.metrics";
import { captureException } from "~/utils/posthogErrorCapture";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";
import { withAppRouterTracer } from "../../../../../middleware/app-router-tracer";
import { prisma } from "../../../../../server/db";
import { createLogger } from "../../../../../utils/logger/server";

const tracer = getLangWatchTracer("langwatch.otel.metrics");
const logger = createLogger("langwatch:otel:v1:metrics");

const metricsRequestType = (root as any).opentelemetry.proto.collector.metrics
  .v1.ExportMetricsServiceRequest;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

async function handleMetricsRequest(req: NextRequest) {
  return await tracer.withActiveSpan(
    "[POST] /api/otel/v1/metrics",
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

      span.setAttribute("langwatch.project.id", project.id);

      const body = await req.arrayBuffer();
      let metricsRequest: IExportMetricsServiceRequest;
      try {
        if (contentType === "application/json") {
          metricsRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          metricsRequest = metricsRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          metricsRequest = metricsRequestType.decode(
            new Uint8Array(metricsRequestType.encode(json).finish()),
          );
        } catch (jsonError) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse metrics",
          });
          span.recordException(
            jsonError instanceof Error
              ? jsonError
              : new Error(String(jsonError)),
          );

          logger.error(
            {
              error: jsonError,
              metricsRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing metrics",
          );

          captureException(error, {
            extra: {
              projectId: project.id,
              metricsRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          return NextResponse.json(
            { error: "Failed to parse metrics" },
            { status: 400 },
          );
        }
      }

      const tracesGeneratedFromMetrics =
        await openTelemetryMetricsRequestToTracesForCollection(metricsRequest);

      const promises = await tracer.withActiveSpan(
        "check which traces have already been collected",
        { kind: SpanKind.INTERNAL },
        async () => {
          const promises: Promise<void>[] = [];
          for (const traceForCollection of tracesGeneratedFromMetrics) {
            const paramsMD5 = crypto
              .createHash("md5")
              .update(superjson.stringify({ ...traceForCollection }))
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
                metricsRequestSizeMb: parseFloat(
                  (body.byteLength / (1024 * 1024)).toFixed(3),
                ),
              },
              "collecting traces from metrics",
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
        return NextResponse.json({ message: "No changes" });
      }

      await tracer.withActiveSpan(
        "push pending traces to collector queue",
        { kind: SpanKind.PRODUCER },
        async () => {
          await Promise.all(promises);
        },
      );

      return NextResponse.json({ message: "OK" }, { status: 200 });
    },
  );
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterTracer("langwatch.otel.v1.metrics")(
  withAppRouterLogger(handleMetricsRequest),
);
