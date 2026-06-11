# Skill: Improve Setup

**Purpose**: Full audit of LangWatch usage + suggest the highest-impact fixes first.

**When to use**: User asks to "audit my setup", "improve my setup", "what's missing", "best practices".

**Workflow**:
1. Run `search_traces`, `list_scenarios`, `list_datasets`, `list_evaluators`, `list_prompts` in parallel.
2. Identify gaps (no scenarios? weak dataset? broken traces?).
3. Report the single biggest gap.
4. Offer to apply the matching skill to fix it.
