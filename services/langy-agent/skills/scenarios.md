# Skill: Scenarios

**Purpose**: Multi-turn conversation testing & red teaming using `UserSimulatorAgent` and `RedTeamAgent`.

**When to use**: User asks to "test conversations", "edge cases", "adversarial test", "red team", "tool-call sequences".

**Workflow**:
1. List existing scenarios first (`list_scenarios`).
2. If none match: `create_scenario` with sensible defaults.
3. Run via `run_suite`.

**Key MCP tools**: `list_scenarios`, `get_scenario`, `create_scenario`, `run_suite`, `update_scenario`.

**Key CLI calls**:
- `langwatch scenario-docs`
- `langwatch scenario create`
- Uses `@langwatch/scenario` SDK.
