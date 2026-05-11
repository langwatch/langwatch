import { type Job, Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { generateText } from "ai";
import { withJobContext } from "../../context/asyncContext";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
  recordJobWaitDuration,
} from "../../metrics";
import { connection } from "../../redis";
import { prisma } from "../../db";
import { LANGY_BOOTSTRAP_QUEUE } from "../queues/constants";
import { LangyProjectMemoryService } from "../../services/langy";
import { getVercelAIModel } from "../../modelProviders/utils";
import { TiktokenClient } from "../../app-layer/clients/tokenizer/tiktoken.client";

const logger = createLogger("langwatch:workers:langyBootstrapWorker");

const FALLBACK_MODEL = "openai/gpt-5-mini";
const TARGET_TOKEN_CAP = 2000;

export type LangyBootstrapJob = {
  projectId: string;
};

const BOOTSTRAP_PROMPT = `You are bootstrapping a project memory file for the LangWatch assistant "Langy".

Read the snapshot of the project below (evaluators, prompts, recent traces). Produce a concise markdown brief that helps Langy understand:
- What this project appears to do (one sentence)
- Key evaluators in use and what they check
- Notable prompts and their purpose
- Anything unusual or noteworthy in recent activity

Keep it under 1500 tokens. Use plain language. No code blocks unless essential. Do not invent facts.`;

async function gatherProjectSnapshot(projectId: string) {
  const [project, evaluators, prompts, datasets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, language: true, framework: true, defaultModel: true },
    }),
    prisma.evaluator.findMany({
      where: { projectId },
      select: { name: true, slug: true, type: true },
      take: 50,
    }),
    prisma.llmPromptConfig.findMany({
      where: { projectId },
      select: { handle: true, name: true },
      take: 50,
    }),
    prisma.dataset.findMany({
      where: { projectId, archivedAt: null },
      select: { name: true, slug: true },
      take: 50,
    }),
  ]);

  return { project, evaluators, prompts, datasets };
}

export async function runLangyBootstrapJob(
  job: Job<LangyBootstrapJob, void, string>,
) {
  const { projectId } = job.data;
  recordJobWaitDuration(job, "langy_bootstrap");
  getJobProcessingCounter("langy_bootstrap", "processing").inc();
  const start = Date.now();

  try {
    const memoryService = LangyProjectMemoryService.create(prisma);

    const existing = await memoryService.getById({ projectId });
    if (existing) {
      logger.info({ projectId }, "project memory already exists, skipping bootstrap");
      return;
    }

    const snapshot = await gatherProjectSnapshot(projectId);
    if (!snapshot.project) {
      logger.warn({ projectId }, "project not found, skipping langy bootstrap");
      return;
    }

    const userMessage = `Project snapshot (JSON):\n\n${JSON.stringify(snapshot, null, 2)}`;

    let content: string;
    try {
      // Spec: project's configured default LLM; fallback gpt-5-mini if none.
      // getVercelAIModel(projectId) uses project default with its own
      // fallback (DEFAULT_MODEL). If neither resolves, we retry with
      // gpt-5-mini explicitly.
      let model;
      try {
        model = await getVercelAIModel(projectId);
      } catch {
        model = await getVercelAIModel(projectId, FALLBACK_MODEL);
      }
      const result = await generateText({
        model,
        system: BOOTSTRAP_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      content = result.text.trim();
    } catch (error) {
      logger.warn(
        { projectId, error: error instanceof Error ? error.message : String(error) },
        "LLM bootstrap failed, writing minimal starter memory",
      );
      content = renderMinimalStarter(snapshot);
    }

    const tokenizer = new TiktokenClient();
    const tokens = await tokenizer.countTokens(FALLBACK_MODEL, content);
    const contentSummary =
      tokens && tokens > TARGET_TOKEN_CAP
        ? content.slice(0, Math.floor((TARGET_TOKEN_CAP / tokens) * content.length))
        : null;

    await memoryService.writeNewVersion({
      projectId,
      content,
      contentSummary,
      changeReason: "auto_bootstrap",
      changedById: null,
    });

    getJobProcessingCounter("langy_bootstrap", "completed").inc();
    getJobProcessingDurationHistogram("langy_bootstrap").observe(Date.now() - start);
  } catch (error) {
    getJobProcessingCounter("langy_bootstrap", "failed").inc();
    logger.error({ jobId: job.id, error }, "failed to bootstrap langy project memory");
    await withScope(async (scope) => {
      scope.setTag?.("worker", "langyBootstrap");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
    throw error;
  }
}

function renderMinimalStarter(snapshot: Awaited<ReturnType<typeof gatherProjectSnapshot>>) {
  const lines: string[] = [];
  lines.push(`# ${snapshot.project?.name ?? "Project"} — Langy memory`);
  lines.push("");
  lines.push("(Auto-generated starter memory. Edit me in Settings → Langy.)");
  lines.push("");
  if (snapshot.evaluators.length > 0) {
    lines.push("## Evaluators");
    for (const e of snapshot.evaluators.slice(0, 10)) {
      lines.push(`- ${e.name} (${e.type})`);
    }
    lines.push("");
  }
  if (snapshot.prompts.length > 0) {
    lines.push("## Prompts");
    for (const p of snapshot.prompts.slice(0, 10)) {
      lines.push(`- ${p.name ?? p.handle}`);
    }
    lines.push("");
  }
  if (snapshot.datasets.length > 0) {
    lines.push("## Datasets");
    for (const d of snapshot.datasets.slice(0, 10)) {
      lines.push(`- ${d.name}`);
    }
  }
  return lines.join("\n");
}

export const startLangyBootstrapWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping langy bootstrap worker");
    return;
  }

  const worker = new Worker<LangyBootstrapJob, void, string>(
    LANGY_BOOTSTRAP_QUEUE.NAME,
    withJobContext(runLangyBootstrapJob),
    {
      connection,
      concurrency: 2,
      telemetry: new BullMQOtel(LANGY_BOOTSTRAP_QUEUE.NAME),
    },
  );

  worker.on("ready", () => {
    logger.info("langy bootstrap worker active, waiting for jobs!");
  });

  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "langy bootstrap job failed");
    getJobProcessingCounter("langy_bootstrap", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "langyBootstrap");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  return worker;
};
