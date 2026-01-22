---
name: code
description: "Delegate implementation work to the coder agent. Provide requirements or feature file path."
context: fork
agent: coder
user-invocable: true
argument-hint: "[requirements or feature-file-path]"
---

Implement the following:

$ARGUMENTS

Follow your workflow: anchor to requirements, read standards, implement with TDD, self-verify, return summary.
