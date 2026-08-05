/**
 * Hono app for the run report.
 *
 * POST /download — produces one self-contained HTML report for one run.
 *
 * This is the API layer: auth, audit, headers. All of the domain logic lives in
 * BatchRunReportService, which knows nothing about HTTP.
 *
 * Two shapes, one handler. `?stream=1` narrates the wait as NDJSON and is what
 * the browser asks for; without it the whole document comes back at once, for
 * a caller that just wants the file. Either way the DOCUMENT is delivered
 * whole on one line rather than progressively, because the tier — how much of
 * the report survived being produced — has to be known before any of it can be
 * read, and a half report is a worse artifact than a slower whole one.
 *
 * Rejections decided BEFORE the stream opens are HTTP statuses carrying a
 * handled-error code. Once the first byte is out the status is spent, so a
 * later failure travels as a line carrying the same kind of code.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { createLogger } from "@langwatch/observability";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { BatchRunNotFoundError } from "~/server/export/batch-run-report/batch-run-report.service";
import {
  RunReportBatchNotFoundError,
  RunReportForbiddenError,
  RunReportRateLimitedError,
} from "~/server/export/batch-run-report/errors";
import { renderReportHtml } from "~/server/export/batch-run-report/render/render-report-html";
import {
  type BatchRunReportRequest,
  batchRunReportRequestSchema,
  type ReportModel,
} from "~/server/export/batch-run-report/report.types";
import { checkReportRateLimit } from "~/server/export/batch-run-report/report-rate-limit";
import { ExportUnauthenticatedError } from "~/server/export/errors";
import type { ReportStage } from "~/shared/scenario-run-report/report-stages";
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
        throw new RunReportForbiddenError(request.projectId);
      }

      // Only the analysed path is limited. The instant one is arithmetic and
      // returns in a fraction of a second; this one is two model calls over up
      // to twenty-four transcripts, and nothing else stops a forty-row run
      // history becoming forty concurrent pairs of them.
      if (request.withAnalysis) {
        const rateLimit = await checkReportRateLimit({
          userId: session.user.id,
          projectId: request.projectId,
        });
        if (!rateLimit.isAllowed) {
          throw new RunReportRateLimitedError(rateLimit.retryAfterSeconds);
        }
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
          throw new RunReportBatchNotFoundError(request.batchRunId, {
            reasons: [error],
          });
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
 *
 * A failure AFTER the first byte cannot become an HTTP status, because the
 * status is long gone. So it arrives as a line carrying an error code, which
 * the client renders from the same registry it renders a rejected request
 * from. Only the pre-stream rejections above are statuses.
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
      // A reader that navigated away, or hit cancel, leaves the controller
      // closed while the generation it started is still running. Enqueuing
      // onto it throws, and the throw escapes `start`, which is how a
      // cancelled export used to surface as an unhandled rejection instead of
      // as nothing at all. Every write goes through here, including the last.
      let isOpen = true;
      const send = (payload: unknown) => {
        if (!isOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          isOpen = false;
        }
      };
      const close = () => {
        if (!isOpen) return;
        isOpen = false;
        try {
          controller.close();
        } catch {
          // Already closed by the reader going away. Nothing left to do.
        }
      };

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
        // The abort is the reader cancelling. It has already stopped
        // listening, and an error line describing its own cancellation would
        // read to it as a failure.
        if (!isAbort(error)) {
          send({
            error:
              error instanceof BatchRunNotFoundError
                ? "scenario_batch_run_not_found"
                : "export_failed",
          });
          logger.error(
            { error, batchRunId: request.batchRunId },
            "Run report stream failed",
          );
        }
      } finally {
        close();
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

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
