import type { Node } from "@xyflow/react";
import type { Entry, Workflow } from "./dsl";

export const migrateDSLVersion = (dsl_: Workflow) => {
  const dsl = JSON.parse(JSON.stringify(dsl_)) as Workflow;

  // @ts-expect-error
  if (dsl.spec_version === "1.0") {
    // @ts-expect-error
    dsl.spec_version = "1.1";
    dsl.nodes.forEach((node) => {
      if (node.type === "entry") {
        const node_ = node as Node<Entry>;
        // @ts-expect-error
        node_.data.test_size = node_.data.train_test_split ?? 0.2;
        // @ts-expect-error
        delete node_.data.train_test_split;
        node_.data.train_size = 1 - node_.data.test_size;
      }
    });
  }

  // @ts-expect-error
  if (dsl.spec_version === "1.1") {
    dsl.spec_version = "1.2";
    dsl.nodes.forEach((node) => {
      if (node.data.parameters) {
        node.data.parameters = node.data.parameters.map((p) => ({
          ...p,
          // @ts-expect-error
          value: p.defaultValue ?? undefined,
        }));
      }
      if (node.type === "signature") {
        node.data.parameters = [
          {
            identifier: "llm",
            type: "llm",
            // @ts-expect-error
            value: node.data.llm,
          },
          {
            identifier: "prompting_technique",
            type: "prompting_technique",
            // @ts-expect-error
            value: node.data.decorated_by,
          },
          {
            identifier: "instructions",
            type: "str",
            // @ts-expect-error
            value: node.data.prompt,
          },
          {
            identifier: "demonstrations",
            type: "dataset",
            // @ts-expect-error
            value: node.data.demonstrations,
          },
        ];
        // @ts-expect-error
        delete node.data.llm;
        // @ts-expect-error
        delete node.data.decorated_by;
        // @ts-expect-error
        delete node.data.prompt;
        // @ts-expect-error
        delete node.data.demonstrations;
      }
    });
  }

  return dsl;
};
