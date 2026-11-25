import { describe, expect, it } from "vitest";

import { diffModelDefaults, type ModelDefaultConfig } from "./topic-world.ts";

const before: ModelDefaultConfig[] = [
  {
    id: "project",
    config: { DEFAULT: "openai/gpt-5-mini", EMBEDDINGS: "openai/text-embedding-3-large" },
  },
  { id: "org", config: { DEFAULT: "openai/gpt-5-mini" } },
];

describe("diffModelDefaults", () => {
  it("reports nothing when the defaults are as setup found them, whatever the key order", () => {
    const after: ModelDefaultConfig[] = [
      { id: "org", config: { DEFAULT: "openai/gpt-5-mini" } },
      {
        id: "project",
        config: { EMBEDDINGS: "openai/text-embedding-3-large", DEFAULT: "openai/gpt-5-mini" },
      },
    ];

    expect(diffModelDefaults({ before, after })).toEqual({
      model_defaults_changed: false,
      changed_keys: [],
      added_config_ids: [],
      removed_config_ids: [],
    });
  });

  it("names the topic clustering keys Langy set on an existing config", () => {
    const after: ModelDefaultConfig[] = [
      {
        id: "project",
        config: {
          ...before[0]!.config,
          "analytics.topic_clustering_llm": "openai/gpt-5-mini",
          "analytics.topic_clustering_embeddings": "openai/text-embedding-3-small",
        },
      },
      before[1]!,
    ];

    const facts = diffModelDefaults({ before, after });

    expect(facts.model_defaults_changed).toBe(true);
    expect(facts.changed_keys).toEqual([
      "analytics.topic_clustering_embeddings",
      "analytics.topic_clustering_llm",
    ]);
  });

  it("names a config added and one removed", () => {
    const after: ModelDefaultConfig[] = [before[0]!, { id: "new", config: { EMBEDDINGS: "x" } }];

    const facts = diffModelDefaults({ before, after });

    expect(facts.added_config_ids).toEqual(["new"]);
    expect(facts.removed_config_ids).toEqual(["org"]);
    expect(facts.changed_keys).toEqual(["EMBEDDINGS"]);
  });
});
