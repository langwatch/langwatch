import type { Node } from "@xyflow/react";
import type { Entry, LLMConfig, Workflow } from "./dsl";

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
    // @ts-expect-error
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

  // @ts-expect-error
  if (dsl.spec_version === "1.2") {
    // @ts-expect-error
    dsl.spec_version = "1.3";
    dsl.enable_tracing = true;
  }

  // @ts-expect-error
  if (dsl.spec_version === "1.3") {
    // @ts-expect-error
    dsl.spec_version = "1.4";
    dsl.template_adapter = "dspy_chat_adapter";
  }

  // @ts-expect-error
  if (dsl.spec_version === "1.4") {
    dsl.spec_version = "1.5";
    // Workflow-level default_llm is gone: every LLM node owns its config.
    // Fold the old default into any llm parameter that has no model of its
    // own, then drop the field. A node keeps its explicit sampling params
    // when only the model was missing.
    const defaultLLM = (dsl as { default_llm?: LLMConfig }).default_llm;
    if (typeof defaultLLM?.model === "string" && defaultLLM.model !== "") {
      dsl.nodes.forEach((node) => {
        node.data.parameters = node.data.parameters?.map((p) => {
          if (p.type !== "llm") return p;
          const value = p.value as LLMConfig | undefined | null;
          if (value?.model) return p;
          return { ...p, value: { ...defaultLLM, ...value, model: defaultLLM.model } };
        });
      });
    }
    delete (dsl as { default_llm?: LLMConfig }).default_llm;
  }

  return dsl;
};
