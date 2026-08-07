import type { PrismaClient } from "@prisma/client";

import type { LLMConfig } from "../../optimization_studio/types/dsl";
import { DEFAULT_MODEL } from "../../utils/constants";
import { ModelNotConfiguredError } from "../modelProviders/modelNotConfiguredError";
import { resolveModelForFeature } from "../modelProviders/resolveModelForFeature";

type LlmParamLike = {
  identifier?: string;
  type?: string;
  value?: unknown;
};

type NodeLike = {
  data?: {
    parameters?: LlmParamLike[];
  };
};

type DslLike = {
  default_llm?: LLMConfig | null;
  nodes?: NodeLike[];
};

const hasModel = (value: unknown): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LLMConfig).model === "string" &&
    (value as LLMConfig).model !== ""
  );
};

/**
 * Every LLM node owns its config: there is no workflow-level default at
 * execution time. This is the persistence chokepoint that guarantees it —
 * any llm parameter arriving without a model is filled in before the
 * version is written, so no persisted DSL can fail at run time with a
 * missing model.
 *
 * Fill order per modelless llm parameter:
 *   1. The payload's legacy `default_llm` (old clients still send it) —
 *      same folding the spec_version 1.5 migration applies on read.
 *   2. The project's cascade-resolved `workflows.create_default` model.
 *   3. `DEFAULT_MODEL` (registry flagship) — the same terminal fallback
 *      prompts and scenario runs use, so a fresh install with zero
 *      configuration still creates runnable workflows. Seeding defaults
 *      must never be a precondition.
 *
 * The legacy `default_llm` field is dropped from the DSL afterwards.
 * Mutates `dsl` in place and only touches the database when a gap exists.
 */
export const materializeNodeLlmConfigs = async ({
  prisma,
  projectId,
  dsl,
}: {
  prisma: PrismaClient;
  projectId: string;
  dsl: DslLike;
}): Promise<void> => {
  const legacyDefault =
    dsl.default_llm && hasModel(dsl.default_llm) ? dsl.default_llm : undefined;
  delete dsl.default_llm;

  const modellessParams = (dsl.nodes ?? [])
    .flatMap((node) => node.data?.parameters ?? [])
    .filter((p) => p.type === "llm" && !hasModel(p.value));
  if (modellessParams.length === 0) {
    return;
  }

  let fallback: LLMConfig | undefined = legacyDefault;
  if (!fallback) {
    let resolvedModel: string | undefined;
    try {
      const resolved = await resolveModelForFeature(
        "workflows.create_default",
        { prisma, projectId },
      );
      resolvedModel = resolved.model;
    } catch (error) {
      // Only "nothing configured at any scope" falls back to the registry
      // flagship — infrastructure failures must not silently pin a model.
      if (!(error instanceof ModelNotConfiguredError)) throw error;
    }
    fallback = { model: resolvedModel ?? DEFAULT_MODEL };
  }

  for (const param of modellessParams) {
    const value = (param.value ?? {}) as Partial<LLMConfig>;
    param.value = { ...fallback, ...value, model: fallback.model };
  }
};
