# Skill: Evaluations

**Purpose**: Set up QA testing — experiments (batch), online evaluation (production monitors), evaluators (scoring functions), and datasets.

**When to use**: User asks to "test my agent", "evaluate", "run evals", "benchmark", "add safety monitors".

**Workflow**:
1. Map the request → Experiments, Online Eval, Evaluators, or Datasets.
2. Create the eval infrastructure via SDK or CLI.
3. Run batch tests or set up production monitors.

**Key MCP tools**: `list_evaluators`, `create_evaluator`, `run_evaluation`, `update_evaluator`.

**Key CLI calls**:
- `langwatch docs evaluations/overview`
- `langwatch experiment`
- `langwatch monitor`
