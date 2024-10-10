export type MODULES = {
  evaluator: {
    cls: "ExactMatchEvaluator";
    inputs: [
      { identifier: "output"; type: "str" },
      { identifier: "expected_output"; type: "str" },
    ];
    outputs: [
      { identifier: "passed"; type: "bool" },
      { identifier: "score"; type: "float" },
    ];
  } | {
    cls: "azure/prompt_injection";
    inputs: [
      { identifier: "input"; type: "str" },
      { identifier: "contexts"; type: "list[str]", optional: true },
    ];
    outputs: [
      { identifier: "passed"; type: "bool" },
    ];
  };
};
