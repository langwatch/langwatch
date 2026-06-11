# Skill: Debug Instrumentation

**Purpose**: Troubleshoot tracing issues — empty inputs/outputs, disconnected spans, missing metadata.

**When to use**: User reports "traces aren't arriving", "traces look broken", "spans disconnected", "missing input/output".

**Workflow**:
1. `search_traces` to inspect recent traces.
2. Identify the issue (empty fields, broken spans, missing metadata).
3. Trace it back to instrumentation code.
4. Apply the fix.
5. Verify with another `search_traces` call.
