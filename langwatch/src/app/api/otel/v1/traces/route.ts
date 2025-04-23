/**
 * Let Op!
 *
 * This endpoint does not work when running on devmode with turbo pack.
 * To develop it, start the server with `USE_WEBPACK=true npm run dev`.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  type IExportTraceServiceRequest,
  // @ts-ignore
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { prisma } from "../../../../../server/db";
import { openTelemetryTraceRequestToTracesForCollection } from "../../../../../server/tracer/opentelemetry";
import { getDebugger } from "../../../../../utils/logger";
import * as Sentry from "@sentry/nextjs";
import * as crypto from "crypto";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "../../../../../server/background/workers/collectorWorker";

const debug = getDebugger("langwatch:otel:v1:traces");

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

export async function POST(req: NextRequest) {
  const body = await req.arrayBuffer();

  const xAuthToken = req.headers.get("x-auth-token");
  const authHeader = req.headers.get("authorization");
  const contentType = req.headers.get("content-type");

  const authToken =
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null);

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
        new Uint8Array(traceRequestType.encode(json).finish())
      );
      if (
        !traceRequest.resourceSpans ||
        traceRequest.resourceSpans.length === 0
      ) {
        throw new Error("Spans are empty, likely an invalid format");
      }
    } catch (jsonError) {
      debug("Error parsing traces:", Buffer.from(body).toString("base64"));
      Sentry.captureException(error, {
        extra: {
          projectId: project.id,
          traceRequest: Buffer.from(body).toString("base64"),
          jsonError,
        },
      });

      return NextResponse.json(
        { error: "Failed to parse traces" },
        { status: 400 }
      );
    }
  }

  const tracesForCollection =
    openTelemetryTraceRequestToTracesForCollection(traceRequest);

  const promises: Promise<void>[] = [];
  for (const traceForCollection of tracesForCollection) {
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

    debug(`collecting traceId ${traceForCollection.traceId}`);

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
  return NextResponse.json({ message: "Trace received successfully." });
}
