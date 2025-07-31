import { type IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "../../../../../server/db";
import { createLogger } from "../../../../../utils/logger";
import { withAppRouterLogger } from "../../../../../middleware/app-router-logger";

const logger = createLogger("langwatch:otel:v1:metrics");

const metricsRequestType = (root as any).opentelemetry.proto.collector.metrics
  .v1.ExportMetricsServiceRequest;

async function handleMetricsRequest(req: NextRequest) {
  const body = await req.arrayBuffer();

  const xAuthToken = req.headers.get("x-auth-token");
  const authHeader = req.headers.get("authorization");
  const contentType = req.headers.get("content-type");

  const authToken =
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null);

  if (!authToken) {
    return NextResponse.json(
      {
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      },
      { status: 401 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: {
      team: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { message: "Invalid auth token." },
      { status: 401 }
    );
  }

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
        new Uint8Array(metricsRequestType.encode(json).finish())
      );
    } catch (jsonError) {
      logger.error(
        {
          error: jsonError,
          metricsRequest: Buffer.from(body).toString("base64"),
        },
        "error parsing metrics"
      );
      Sentry.captureException(error, {
        extra: {
          projectId: project.id,
          metricsRequest: Buffer.from(body).toString("base64"),
          jsonError,
        },
      });

      return NextResponse.json(
        { error: "Failed to parse metrics" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ message: "Not implemented" }, { status: 501 });
}

// Export the handler wrapped with logging middleware
export const POST = withAppRouterLogger(handleMetricsRequest);
