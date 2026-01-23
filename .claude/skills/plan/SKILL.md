---
name: plan
description: "Create a feature file with acceptance criteria before implementation. Use when no specs/features/*.feature file exists for the work."
context: fork
agent: Plan
user-invocable: true
argument-hint: "[feature description or issue summary]"
---

Create a BDD feature file for: $ARGUMENTS

## Requirements Source

Work should be tied to a GitHub issue. If requirements are unclear:
- Ask for the GitHub issue number
- Use `gh issue view <number>` to fetch full context
- The issue description and acceptance criteria are the source of truth

## Output Location
Write to `specs/features/<feature-name>.feature`

## Feature File Format
```gherkin
Feature: <Feature Name>
  As a <role>
  I want <goal>
  So that <benefit>

  @unit
  Scenario: <unit test scenario>
    Given <precondition>
    When <action>
    Then <expected result>

  @integration
  Scenario: <integration test scenario>
    ...
```

## Guidelines
- Extract clear acceptance criteria from the GitHub issue
- Tag scenarios with @unit, @integration, or @e2e
- Focus on behavior, not implementation
- Keep scenarios independent and atomic
- If requirements are ambiguous, ask for clarification before writing

Return the file path when complete.
