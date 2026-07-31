/**
 * Hono app for the run report.
 *
 * POST /download — produces one self-contained HTML report for one run.
 *
 * This is the API layer: auth, audit, headers. All of the domain logic lives in
 * BatchRunReportService, which knows nothing about HTTP.
 *
 * The response is buffered rather than streamed, because the tier — how much of
 * the report survived being produced — has to be known before the first byte
 * goes out, and a proxy-truncated half report is a worse artifact than a
 * slightly slower whole one.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import { createLogger } from "@langwatch/observability";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { auditLog } from "~/server/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { BatchRunNotFoundError } from "~/server/export/batch-run-report/batch-run-report.service";
import { renderReportHtml } from "~/server/export/batch-run-report/render/render-report-html";
import {
  type BatchRunReportRequest,
  batchRunReportRequestSchema,
  type ReportModel,
  type ReportStage,
} from "~/server/export/batch-run-report/report.types";
import { ExportUnauthenticatedError } from "~/server/export/errors";
import type { NextRequest } from "~/types/next-stubs";

const logger = createLogger("langwatch:api:batch-run-report");

const secured = createServiceApp({ basePath: "/api/export/batch-run-report" });

secured
  .access(
    handlerManagedAuth({
      reason: "user session + scenarios:view enforced in-handler",
      permissions: ["scenarios:view"],
      credential: "session",
    }),
  )
  .post(
    "/download",
    zValidator("json", batchRunReportRequestSchema),
    async (c) => {
      const request = c.req.valid("json");

      const session = await getServerAuthSession({
        req: c.req.raw as NextRequest,
      });
      if (!session) {
        throw new ExportUnauthenticatedError();
      }

      const hasPermission = await hasProjectPermission(
        { prisma, session },
        request.projectId,
        "scenarios:view",
      );
      if (!hasPermission) {
        return c.json(
          { error: "You do not have permission to access this endpoint." },
          { status: 403 },
        );
      }

      // A report bundles conversation transcripts and a model's reading of
      // them, so producing one is at least as attributable as exporting the
      // raw rows. Recorded before any of it is written.
      await auditLog({
        userId: session.user.id,
        projectId: request.projectId,
        action: "scenarioRunReport.export",
        targetKind: "project",
        targetId: request.projectId,
        args: {
          scenarioSetId: request.scenarioSetId,
          batchRunId: request.batchRunId,
        },
      });

      // The two model passes take tens of seconds each and everything else
      // takes under a millisecond, so the caller is told which stage it is
      // waiting in rather than left with a spinner. Streamed on the same
      // request: a status endpoint would mean persisting a job, a projection
      // and a retention policy to narrate a single wait.
      if (c.req.query("stream") === "1") {
        return streamReport({ request, signal: c.req.raw.signal });
      }

      let model: ReportModel;
      try {
        model = await getApp().simulations.report.generate({
          request,
          // Stamped here rather than at render time so the renderer stays a
          // pure function of its input and the same run produces the same file.
          generatedAt: new Date().toISOString(),
          abortSignal: c.req.raw.signal,
        });
      } catch (error) {
        if (error instanceof BatchRunNotFoundError) {
          return c.json({ error: "Run not found." }, { status: 404 });
        }
        throw error;
      }

      logger.info(
        {
          projectId: request.projectId,
          batchRunId: request.batchRunId,
          tier: model.tier,
        },
        "Produced run report",
      );

      const html = renderReportHtml({ model });

      return new Response(html, {
        headers: new Headers({
          "Content-Type": "text/html; charset=utf-8",
          // The file is opened from disk, never rendered from this origin, but
          // a browser that sniffs it into an active context would be running
          // model-authored text as markup.
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename="${buildFileName({
            suiteName: request.suiteName,
            generatedAt: model.meta.generatedAt,
          })}"`,
          "X-Report-Tier": model.tier,
          "Access-Control-Expose-Headers": "X-Report-Tier, Content-Disposition",
        }),
      });
    },
  );

/**
 * The same report, delivered as a progress stream.
 *
 * One JSON object per line rather than Server-Sent Events: the client is a
 * fetch reader, not an EventSource, and a line is the whole protocol. Stages
 * arrive as they begin and the finished document arrives last, so the wait is
 * narrated without the report ever being half-written on screen.
 */
function streamReport({
  request,
  signal,
}: {
  request: BatchRunReportRequest;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));

      try {
        const model = await getApp().simulations.report.generate({
          request,
          generatedAt: new Date().toISOString(),
          abortSignal: signal,
          onProgress: (stage: ReportStage) => send({ stage }),
        });
        send({
          done: true,
          tier: model.tier,
          filename: buildFileName({
            suiteName: request.suiteName,
            generatedAt: model.meta.generatedAt,
          }),
          html: renderReportHtml({ model }),
        });
      } catch (error) {
        send({
          error:
            error instanceof BatchRunNotFoundError
              ? "Run not found."
              : "The report could not be produced.",
        });
        logger.error(
          { error, batchRunId: request.batchRunId },
          "Run report stream failed",
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: new Headers({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

/**
 * Content-Disposition's filename is a quoted string, so a quote in the suite
 * name would close it and let the caller append parameters. The suite name is
 * caller-supplied text, so it is reduced to characters that cannot do that
 * rather than trusted.
 */
function buildFileName({
  suiteName,
  generatedAt,
}: {
  suiteName?: string;
  generatedAt: string;
}): string {
  const safeName = (suiteName ?? "Run").replace(/[^\w .-]/g, "_").slice(0, 80);
  const day = generatedAt.slice(0, 10);
  return `${safeName} - Run Report - ${day}.html`;
}

export const app = secured.hono;
