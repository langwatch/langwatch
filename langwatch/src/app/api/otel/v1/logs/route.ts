import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { type NextRequest, NextResponse } from "next/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { readBody } from "../../decompressBody";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";
import { withAppRouterTracer } from "../../../../../middleware/app-router-tracer";
import { getApp } from "../../../../../server/app-layer/app";
import { prisma } from "../../../../../server/db";
import { createLogger } from "../../../../../utils/logger/server";

const tracer = getLangWatchTracer("langwatch.otel.logs");
const logger = createLogger("langwatch:otel:v1:logs");

const logRequestType = (root as any).opentelemetry.proto.collector.logs.v1
  .ExportLogsServiceRequest;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

async function handleLogsRequest(req: NextRequest) {
  return await tracer.withActiveSpan(
    "[POST] /api/otel/v1/logs",
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
            await getApp().usageLimits.notifyPlanLimitReached({
              organizationId: project.team.organizationId,
              planName: activePlan.name ?? "free",
            });
          } catch (error) {
            logger.error(
              { error, projectId: project.id },
              "Error sending plan limit notification",
            );
          }

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
        captureException(error as Error, {
          extra: { projectId: project.id },
        });
      }

      span.setAttribute("langwatch.project.id", project.id);

      const body = await readBody(req);
      let logRequest: IExportLogsServiceRequest;
      try {
        if (contentType === "application/json") {
          logRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          logRequest = logRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          logRequest = logRequestType.decode(
            new Uint8Array(logRequestType.encode(json).finish()),
          );
        } catch (jsonError) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse logs",
          });
          span.recordException(
            jsonError instanceof Error
              ? jsonError
              : new Error(String(jsonError)),
          );

          logger.error(
            {
              error: jsonError,
              logRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing logs",
          );

          captureException(error, {
            extra: {
              projectId: project.id,
              logRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          return NextResponse.json(
            { error: "Failed to parse logs" },
            { status: 400 },
          );
        }
      }
      // Ingest logs via event sourcing into ClickHouse
      await getApp().traces.logCollection.handleOtlpLogRequest({
        tenantId: project.id,
        logRequest,
        piiRedactionLevel: project.piiRedactionLevel,
      });

      return NextResponse.json({ message: "OK" });
    },
  );
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterTracer("langwatch.otel.v1.logs")(
  withAppRouterLogger(handleLogsRequest),
);
