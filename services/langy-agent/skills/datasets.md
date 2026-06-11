# Skill: Datasets

**Purpose**: Generate realistic evaluation data from codebase, prompts, traces, and git history.

**When to use**: User asks to "build a dataset", "create test data", "add examples", "benchmark dataset".

**Workflow**:
1. Discovery phase: read codebase + prompts + traces to understand domain.
2. Generate domain-specific test data matching real patterns.
3. `create_dataset` + `create_dataset_records`.
4. Optional: multi-turn conversations & adversarial cases.

**CRITICAL — committing rows**: When the user provides rows inline (e.g. "with 3 rows: France->Paris, Germany->Berlin, Japan->Tokyo"), you MUST make TWO sequential MCP tool calls:
  1. `platform_create_dataset` — pass a schema/columns matching the row shape (e.g. columns `[input, output]`).
  2. `platform_create_dataset_records` — pass the rows as records, using the dataset id from step 1.
Never claim "added N rows" after only step 1. The dataset exists but is empty until step 2 runs. If step 2 fails or you skip it, say so explicitly — do not pretend the rows are committed.

**Key MCP tools**: `list_datasets`, `get_dataset`, `create_dataset`, `create_dataset_records`, `update_dataset`.

**Key CLI calls**:
- `langwatch dataset create`
- `langwatch dataset upload`
- `langwatch dataset records add`
