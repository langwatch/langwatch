import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { type NextRequest, NextResponse } from "next/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { readBody } from "../../decompressBody";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";
import { withAppRouterTracer } from "../../../../../middleware/app-router-tracer";
import { prisma } from "../../../../../server/db";
import { getApp } from "../../../../../server/app-layer/app";
import { createLogger } from "../../../../../utils/logger/server";

const tracer = getLangWatchTracer("langwatch.otel.traces");
const logger = createLogger("langwatch:otel:v1:traces");

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
            const activePlan = await getApp().planProvider.getActivePlan({
              organizationId: project.team.organizationId,
            });

            getApp().usageLimits.notifyPlanLimitReached({
              organizationId: project.team.organizationId,
              planName: activePlan.name ?? "free",
            }).catch(error => {
              logger.error(
              { error, projectId: project.id },
              "Error sending plan limit notification",
            );
            });
          } catch (error) {
            logger.error(
              { error, projectId: project.id },
              "Error getting active plan information",
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

      const body = await readBody(req);

      const emptyPartialSuccess = { rejectedSpans: 0, errorMessage: "" };

      // Handle empty body gracefully - protobuf decode throws on empty input.
      // OTEL SDKs may send empty requests during shutdown/flush cycles.
      if (body.byteLength === 0) {
        logger.debug("Received empty trace request, ignoring");
        return NextResponse.json({
          message: "No traces to process",
          partialSuccess: emptyPartialSuccess,
        });
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

      // Ingest raw OTEL spans directly via event sourcing into ClickHouse
      const collectionResult =
        await getApp().traces.collection.handleOtlpTraceRequest(
          project.id,
          traceRequest,
          project.piiRedactionLevel,
        );

      return NextResponse.json({
        message: "Trace received successfully.",
        partialSuccess: {
          rejectedSpans: collectionResult?.rejectedSpans ?? 0,
          errorMessage: collectionResult?.errorMessage ?? "",
        },
      });
    },
  );
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterTracer("langwatch.otel.v1.traces")(
  withAppRouterLogger(handleTracesRequest),
);
