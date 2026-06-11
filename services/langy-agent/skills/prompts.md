# Skill: Prompts

**Purpose**: Version and manage prompts externally — discover hardcoded prompts, create managed versions, support tagging (production/staging/latest).

**When to use**: User asks to "manage prompts", "version a prompt", "update prompt", "A/B test prompts", "tag prompt".

**Workflow**:
1. `langwatch prompt init` to scaffold.
2. Discover hardcoded prompts in codebase.
3. `langwatch prompt create` to externalize.
4. Update code to use `langwatch.prompts.get(handle)`.
5. Use `langwatch prompt tag assign` for staging/prod tags.

**Key MCP tools**: `list_prompts`, `get_prompt`, `create_prompt`, `update_prompt`, `create_prompt_tag`, `assign_prompt_tag`.

**Key CLI calls**:
- `langwatch prompt init`
- `langwatch prompt sync`
- `langwatch prompt tag assign`
