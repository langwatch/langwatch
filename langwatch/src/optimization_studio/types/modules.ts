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
  };
};
