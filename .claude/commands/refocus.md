# Refocus

Stop and realign with BDD workflow before continuing.

## Immediate Actions

1. **Compact context** - Run `/compact` to clear noise and focus on essentials

2. **Review relevant specs** - Find and read feature files in `specs/` related to current work:
   - List subdirectories: `ls specs/`
   - Read relevant `.feature` files - these ARE the requirements
   - If no feature file exists for your current task, that is a problem - create one first

3. **Review best practices**:
   - `AGENTS.md` - common mistakes table
   - `docs/TESTING_PHILOSOPHY.md` - workflow and test hierarchy
   - `specs/README.md` - BDD guidance

4. **Rebuild the todo list** - Replace the current todo list with:
   - A "Review feature file for [area]" task (in_progress)
   - Specific implementation tasks derived from the feature scenarios
   - A final task: "Refocus check - verify alignment with spec before completing"

5. **State your plan** - Before writing any code, explicitly state:
   - Which feature file(s) you are implementing
   - Which scenario(s) you are working on
   - What test level (E2E/integration/unit) comes first

## Why This Exists

Agents repeatedly implement code without checking existing specs. This wastes time and creates work that diverges from requirements. The specs are not suggestions - they are the source of truth.
