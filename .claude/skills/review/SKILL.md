---
name: review
description: "Delegate code review to the uncle-bob-reviewer agent. Reviews recent changes for SOLID, TDD, and clean code."
context: fork
agent: uncle-bob-reviewer
user-invocable: true
argument-hint: "[focus-area or file-path]"
---

Review the recent changes:

$ARGUMENTS

Follow your review protocol: SOLID scan, TDD interrogation, clean code inspection. Return structured findings.
