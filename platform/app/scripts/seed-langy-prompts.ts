/**
 * Seed Langy's prompts into LangWatch's own versioned prompt registry (ADR-050).
 *
 * Langy has two prompt surfaces we want stored as versioned `LlmPromptConfig`
 * rows rather than hardcoded:
 *
 *   1. `langy-agent-definition` — the AGENTS.md agent-definition rules doc,
 *      read verbatim from `services/langyagent/internal/assets/AGENTS.md`
 *      (its `${LANGWATCH_ENDPOINT}` placeholder is kept literal — it is
 *      substituted per-worker at spawn, not at seed time).
 *   2. `langy-turn-override` — the per-turn control-plane `system` override,
 *      the `LANGY_TURN_OVERRIDE_FALLBACK` constant.
 *
 * Both are seeded as ORGANIZATION-scoped prompts under a caller-chosen project
 * (the internal "LangWatch system" project that holds these rows) and promoted to
 * the `production` tag, which is what `resolveLangyPrompt` reads by default.
 *
 * IDEMPOTENT: re-running creates a NEW version only when the text changed, then
 * re-points `production` at it. Unchanged text is a no-op.
 *
 * This is a SCRIPT, not a migration: prompt content is data, and the codebase
 * never seeds prompt rows through Prisma migrations (migrations are schema only).
 *
 * Usage (from `platform/app/`):
 *
 *   pnpm tsx scripts/seed-langy-prompts.ts --project <projectId>
 *   LANGY_PROMPT_PROJECT_ID=<projectId> pnpm tsx scripts/seed-langy-prompts.ts
 *   pnpm tsx scripts/seed-langy-prompts.ts --project <projectId> --dry-run
 *   pnpm tsx scripts/seed-langy-prompts.ts --project <projectId> --no-promote
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "~/server/db";
import {
  LANGY_PROMPT_DEFAULT_TAG,
  LANGY_PROMPT_HANDLES,
  LANGY_TURN_OVERRIDE_FALLBACK,
} from "~/server/app-layer/langy/langyPromptRegistry";
import { PromptService } from "~/server/prompt-config/prompt.service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** repo-root/langwatch/scripts → repo root → services/.../AGENTS.md */
const AGENTS_MD_PATH = path.resolve(
  __dirname,
  "../../../services/langyagent/internal/assets/AGENTS.md",
);

const MODEL = "openai/gpt-5-mini";

interface Args {
  projectId: string;
  promote: boolean;
  dryRun: boolean;
  tag: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const projectId =
    get("--project") ?? process.env.LANGY_PROMPT_PROJECT_ID ?? "";
  if (!projectId) {
    throw new Error(
      "Missing project: pass --project <projectId> or set LANGY_PROMPT_PROJECT_ID",
    );
  }
  return {
    projectId,
    promote: !argv.includes("--no-promote"),
    dryRun: argv.includes("--dry-run"),
    tag: get("--tag") ?? LANGY_PROMPT_DEFAULT_TAG,
  };
}

/** Create the prompt (version 1) or add a new version when the text changed. */
async function upsertPrompt(params: {
  service: PromptService;
  projectId: string;
  organizationId: string;
  handle: string;
  prompt: string;
  dryRun: boolean;
}): Promise<{ configId: string; versionId: string } | null> {
  const { service, projectId, organizationId, handle, prompt, dryRun } = params;

  const existing = await service.getPromptByIdOrHandle({ idOrHandle: handle, projectId });

  if (existing && existing.prompt.trim() === prompt.trim()) {
    console.log(`  = ${handle}: unchanged (v${existing.version}) — skipping`);
    return { configId: existing.id, versionId: existing.versionId };
  }

  if (dryRun) {
    console.log(
      existing
        ? `  ~ ${handle}: WOULD add a new version (text changed from v${existing.version})`
        : `  + ${handle}: WOULD create version 1`,
    );
    return null;
  }

  if (!existing) {
    const created = await service.createPrompt({
      projectId,
      organizationId,
      handle,
      scope: "ORGANIZATION",
      prompt,
      model: MODEL,
      commitMessage: "Seed Langy prompt from in-repo source (ADR-050)",
    });
    console.log(`  + ${handle}: created v${created.version}`);
    return { configId: created.id, versionId: created.versionId };
  }

  const updated = await service.updatePrompt({
    idOrHandle: handle,
    projectId,
    data: {
      commitMessage: "Sync Langy prompt from in-repo source (ADR-050)",
      prompt,
    },
  });
  console.log(`  ~ ${handle}: added v${updated.version}`);
  return { configId: updated.id, versionId: updated.versionId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const project = await prisma.project.findUnique({
    where: { id: args.projectId },
    select: { id: true, name: true, team: { select: { organizationId: true } } },
  });
  if (!project) {
    throw new Error(`Project not found: ${args.projectId}`);
  }
  const organizationId = project.team.organizationId;

  const agentDefinition = await fs.readFile(AGENTS_MD_PATH, "utf8");

  console.log(
    `Seeding Langy prompts into project "${project.name}" (${project.id}), org ${organizationId}` +
      (args.dryRun ? " [DRY RUN]" : ""),
  );

  const service = new PromptService(prisma);

  const targets: Array<{ handle: string; prompt: string }> = [
    { handle: LANGY_PROMPT_HANDLES.agentDefinition, prompt: agentDefinition },
    { handle: LANGY_PROMPT_HANDLES.turnOverride, prompt: LANGY_TURN_OVERRIDE_FALLBACK },
  ];

  for (const { handle, prompt } of targets) {
    const result = await upsertPrompt({
      service,
      projectId: args.projectId,
      organizationId,
      handle,
      prompt,
      dryRun: args.dryRun,
    });
    if (result && args.promote && !args.dryRun) {
      await service.assignTag({
        configId: result.configId,
        versionId: result.versionId,
        tag: args.tag,
        projectId: args.projectId,
        organizationId,
      });
      console.log(`    ↳ tagged "${args.tag}"`);
    }
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
