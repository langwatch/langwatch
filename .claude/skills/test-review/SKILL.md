---
name: test-review
description: "Review specs and tests for pyramid placement and quality."
context: fork
agent: test-reviewer
user-invocable: true
argument-hint: "<path>"
---

# Test Review

Review feature files or test files for pyramid placement and quality.

## Usage

```
/test-review <path>
```

Examples:
```
/test-review specs/scenarios/my-feature.feature
/test-review langwatch/src/__tests__/
```

## Focus Area

$ARGUMENTS
