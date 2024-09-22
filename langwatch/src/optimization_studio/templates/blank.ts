import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { Entry, Workflow } from "../types/dsl";

export const blankTemplate: Workflow = {
  spec_version: "1.0",
  name: "Blank Template",
  icon: "🧩",
  description: "Start a new workflow from scratch",
  version: "1.0",
  default_llm: {
    model: "openai/gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  },
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: {
        x: 0,
        y: 0,
      },
      data: {
        name: "Entry",
        outputs: [{ identifier: "question", type: "str" }],
        entry_selection: "first",
        dataset: {
          name: DEFAULT_DATASET_NAME,
          inline: {
            records: {
              question: ["Hello world"],
            },
            columnTypes: [{ name: "question", type: "string" }],
          },
        },
      } as Entry,
    },
  ],
  edges: [],
  state: {},
};
