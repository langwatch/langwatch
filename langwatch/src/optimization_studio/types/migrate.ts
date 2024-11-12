import type { Node } from "@xyflow/react";
import type { Entry, Workflow } from "./dsl";

export const migrateDSLVersion = (dsl_: Workflow) => {
  const dsl = JSON.parse(JSON.stringify(dsl_)) as Workflow;

  // @ts-expect-error
  if (dsl.spec_version === "1.0") {
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

  return dsl;
};
