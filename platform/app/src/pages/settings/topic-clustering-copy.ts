import type { ClusteringErrorCode } from "~/server/app-layer/topic-clustering/clustering-error";
import type {
  TopicClusteringRunMode,
  TopicClusteringSkipReason,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/constants";

/**
 * Customer-facing copy and per-run detail for the topic-clustering settings
 * page. Kept apart from the page component so the wording and the
 * code→guidance mapping can be unit-tested without rendering Chakra + tRPC.
 *
 * The classifier's code is the ONLY thing the server sends about a failure —
 * never the provider's response body, which is a langevals/provider payload
 * (tracebacks, internal hostnames, echoed key prefixes) and not something to
 * put in front of a customer.
 */

/** The top-level route to the model-providers settings page (Vite app). */
export const MODEL_PROVIDERS_HREF = "/settings/model-providers";

/**
 * The server sends bare strings for codes/reasons/modes; these lookups narrow
 * them back onto the canonical unions so an unknown value falls through to
 * each call site's fallback instead of silently rendering nothing new.
 */
export function copyFor<K extends string, V>(
  map: Partial<Record<K, V>>,
  key: string | null,
): V | undefined {
  return key ? map[key as K] : undefined;
}

// Deliberately Partial: a code with no entry is treated as ours to fix, so
// exhaustiveness would defeat the fallback.
export const CLUSTERING_FAILURE_GUIDANCE: Partial<
  Record<ClusteringErrorCode, { title: string; description: string }>
> = {
  model_not_configured: {
    title: "No model is set up for topic clustering",
    description:
      "Choose a default model and embeddings for topic clustering in Settings → Model Providers → Default Models, then run it again.",
  },
  model_restricted: {
    title: "The topic clustering model is not allowed for this feature",
    description:
      "Your default model is a Codex model, which only serves coding assistants. Choose a different model for topic clustering in Settings → Model Providers → Default Models, then run it again.",
  },
  model_provider_auth: {
    title: "Your model provider rejected the credentials",
    description:
      "Check the API key for your topic clustering model in Settings → Model Providers, then run topic clustering again.",
  },
  model_provider_quota: {
    title: "Your model provider refused the request",
    description:
      "This usually means the account is out of quota or credit. Check your limits and billing with the provider, then run topic clustering again.",
  },
};

// Exhaustive over the union on purpose: adding a skip reason without copy for
// it is a compile error here, not a blank line in the UI.
export const SKIP_REASON_COPY: Record<TopicClusteringSkipReason, string> = {
  recently_clustered:
    "Skipped, your topics were rebuilt recently so this run was not needed yet",
  not_enough_traces: "Skipped, not enough new traces to group yet",
  not_configured: "Skipped, no topic clustering model is set up",
};

/** What each run mode did, in the customer's terms rather than the enum's. */
export const RUN_MODE_COPY: Record<TopicClusteringRunMode, string> = {
  batch: "Rebuilt all topics",
  incremental: "Sorted new traces into your existing topics",
};

export interface ClusteringRunDetail {
  outcome: string;
  mode: string | null;
  skippedReason: string | null;
  errorCode: string | null;
  isErrorUserActionable: boolean;
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
}

/**
 * What one history row says about its run, in the customer's terms. The
 * server never sends raw error text (ADR-051 §8) — a failed run's detail is
 * the same fixed guidance the status card uses.
 */
export function runDetail(run: ClusteringRunDetail): string {
  switch (run.outcome) {
    case "completed": {
      const modeCopy = copyFor(RUN_MODE_COPY, run.mode);
      const summary = `Organized ${run.tracesProcessed} traces into ${run.topicsCount} topics and ${run.subtopicsCount} subtopics.`;
      return modeCopy ? `${modeCopy}. ${summary}` : summary;
    }
    case "skipped":
      return `${copyFor(SKIP_REASON_COPY, run.skippedReason) ?? "Skipped"}.`;
    case "failed": {
      const guidance = run.isErrorUserActionable
        ? copyFor(CLUSTERING_FAILURE_GUIDANCE, run.errorCode)
        : undefined;
      return guidance
        ? guidance.title
        : "Failed on our side. It retries automatically at the next scheduled run.";
    }
    case "running":
      return "Working through your recent traces…";
    case "abandoned":
      return "The run was interrupted; the next scheduled run starts fresh.";
    default:
      return "";
  }
}

/**
 * Whether a failed run should offer the "Open Model Providers" link: the
 * failure is the customer's to fix AND we have named guidance for it.
 */
export function showsModelProvidersLink(run: {
  outcome: string;
  errorCode: string | null;
  isErrorUserActionable: boolean;
}): boolean {
  return (
    run.outcome === "failed" &&
    run.isErrorUserActionable &&
    copyFor(CLUSTERING_FAILURE_GUIDANCE, run.errorCode) !== undefined
  );
}
