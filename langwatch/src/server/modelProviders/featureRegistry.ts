/**
 * Feature registry — the single source of truth for every AI-powered
 * surface in the platform that needs a model.
 *
 * Each entry binds a stable feature key to one of the three model roles
 * (DEFAULT / FAST / EMBEDDINGS) and supplies the copy the UI renders when
 * surfacing the role expansion list or the missing-model popup.
 *
 * Rules:
 *   - Keys are snake_case, area-prefixed, and STABLE FOREVER. We deprecate,
 *     never rename. Renaming would orphan every saved override that points
 *     at the old key.
 *   - Adding a new model-using surface is a one-line registry change: drop
 *     a declaration here and `resolveModelForFeature` knows how to walk for
 *     it everywhere. The role lines + their expansion lists in the Default
 *     Models UI also re-render automatically.
 *   - Duplicate keys throw at module load so a copy-paste mistake can't
 *     silently swallow one of the declarations.
 *
 * See specs/model-providers/model-resolver-and-registry.feature for the
 * resolution semantics and the contract this file underpins.
 */

export const MODEL_ROLES = ["DEFAULT", "FAST", "EMBEDDINGS"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export interface FeatureDescriptor {
  /** Stable identifier; persisted in `ModelDefault.featureKey` and used in
   *  the typed error. Format: `<area>.<snake_case_name>`. */
  key: string;
  /** Tier this feature defaults to when no per-feature override exists. */
  role: ModelRole;
  /** User-facing label rendered under the role's expanded list and in the
   *  missing-model popup title. */
  displayName: string;
  /** One-line description rendered under the display name in the expand
   *  list and as the popup body subtext. */
  description: string;
}

const REGISTRY: FeatureDescriptor[] = [
  // DEFAULT — heavy / user-content-creating surfaces.
  {
    key: "prompt.create_default",
    role: "DEFAULT",
    displayName: "New prompt model",
    description: "Model written into a freshly created prompt.",
  },
  {
    key: "evaluator.create_default",
    role: "DEFAULT",
    displayName: "New evaluator model",
    description:
      "Model written into a freshly created LLM-as-a-judge evaluator.",
  },
  {
    key: "scenarios.user_simulator",
    role: "DEFAULT",
    displayName: "Scenario user simulator",
    description:
      "Model that role-plays the user in scenario simulations.",
  },
  {
    key: "scenarios.judge",
    role: "DEFAULT",
    displayName: "Scenario judge",
    description:
      "Model that judges whether a scenario met its success criteria.",
  },

  // FAST — assistive / background surfaces.
  {
    key: "traces.ai_search",
    role: "FAST",
    displayName: "AI search",
    description: "Natural-language search over your traces.",
  },
  {
    key: "workflows.commit_message",
    role: "FAST",
    displayName: "Workflow commit messages",
    description:
      "Auto-generates a commit message when you save a workflow change.",
  },
  {
    key: "studio.autocomplete",
    role: "FAST",
    displayName: "Code editor autocomplete",
    description: "Inline completion in the prompt and workflow editors.",
  },
  {
    key: "scenarios.generator",
    role: "FAST",
    displayName: "Scenario generator",
    description: "Generates synthetic agent scenarios from a goal.",
  },
  {
    key: "datasets.generator",
    role: "FAST",
    displayName: "Dataset generator",
    description: "Generates synthetic dataset rows from a description.",
  },
  {
    key: "translate.text",
    role: "FAST",
    displayName: "Inline translation",
    description: "Translates user-supplied text into English.",
  },
  {
    key: "analytics.topic_clustering_llm",
    role: "FAST",
    // The role column header (FAST) and the EMBEDDINGS counterpart's
    // own row make the LLM-vs-embedding split obvious in context — the
    // "(LLM)" suffix only made the column read like a glossary entry.
    displayName: "Topic clustering",
    description: "Names the clusters surfaced in Analytics → Topics.",
  },

  // EMBEDDINGS — single line, no per-feature expand surfaced in the UI.
  {
    key: "analytics.topic_clustering_embeddings",
    role: "EMBEDDINGS",
    // Same de-suffixing rationale as the FAST counterpart above. The
    // EMBEDDINGS column / row header tells the user what kind of model
    // this is without parenthetical clutter.
    displayName: "Topic clustering",
    description:
      "Vectors used to group similar traces in Analytics → Topics.",
  },
];

/**
 * Asserts every key in a feature-descriptor list is unique. Used both at
 * module load (below) and as the surface tests bind to so we can prove
 * the guard fires without monkey-patching the module system.
 */
export function assertUniqueFeatureKeys(
  features: readonly FeatureDescriptor[],
): void {
  const seen = new Set<string>();
  for (const f of features) {
    if (seen.has(f.key)) {
      throw new Error(
        `Duplicate feature registry key: "${f.key}". Feature keys must be unique.`,
      );
    }
    seen.add(f.key);
  }
}

assertUniqueFeatureKeys(REGISTRY);

export const allFeatures = (): FeatureDescriptor[] => [...REGISTRY];

export const featuresByRole = (role: ModelRole): FeatureDescriptor[] =>
  REGISTRY.filter((f) => f.role === role);

export const featureByKey = (key: string): FeatureDescriptor | undefined =>
  REGISTRY.find((f) => f.key === key);
