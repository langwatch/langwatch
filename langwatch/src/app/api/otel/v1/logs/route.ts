import { type IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import * as Sentry from "@sentry/nextjs";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "../../../../../server/db";
import { createLogger } from "../../../../../utils/logger";
import { openTelemetryLogsRequestToTracesForCollection } from "~/server/tracer/otel.logs";
import { fetchExistingMD5s, scheduleTraceCollectionWithFallback } from "~/server/background/workers/collectorWorker";

const logger = createLogger("langwatch:otel:v1:logs");

const logRequestType = (root as any).opentelemetry.proto.collector.logs.v1
  .ExportLogsServiceRequest;

export async function POST(req: NextRequest) {
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
        new Uint8Array(logRequestType.encode(json).finish())
      );
    } catch (jsonError) {
      logger.error(
        { error: jsonError, logRequest: Buffer.from(body).toString("base64") },
        "error parsing logs"
      );
      Sentry.captureException(error, {
        extra: {
          projectId: project.id,
          logRequest: Buffer.from(body).toString("base64"),
          jsonError,
        },
      });

      return NextResponse.json(
        { error: "Failed to parse logs" },
        { status: 400 }
      );
    }
  }

  const tracesGeneratedFromLogs = openTelemetryLogsRequestToTracesForCollection(logRequest);

  const promises: Promise<void>[] = [];
  for (const traceForCollection of tracesGeneratedFromLogs) {
    const paramsMD5 = crypto
      .createHash("md5")
      .update(JSON.stringify({ ...traceForCollection }))
      .digest("hex");
    const existingTrace = await fetchExistingMD5s(
      traceForCollection.traceId,
      project.id
    );
    if (existingTrace?.indexing_md5s?.includes(paramsMD5)) {
      continue;
    }

    logger.info({ traceId: traceForCollection.traceId }, 'collecting traces from logs');

    promises.push(
      scheduleTraceCollectionWithFallback({
        ...traceForCollection,
        projectId: project.id,
        existingTrace,
        paramsMD5,
        expectedOutput: undefined,
        evaluations: undefined,
        collectedAt: Date.now(),
      })
    );
  }

  if (promises.length === 0) {
    return NextResponse.json({ message: "No changes" });
  }

  await Promise.all(promises);
  return NextResponse.json({ message: "OK" }, { status: 200 });
}
