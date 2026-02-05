---
name: challenge
description: "Stress-test an architecture proposal, plan, or technical idea. Invokes the devils-advocate agent to find weaknesses before you commit."
context: fork
agent: devils-advocate
user-invocable: true
argument-hint: "[proposal or plan to challenge]"
---

Challenge the following proposal. If no specific proposal is provided, review the current conversation context for any architecture decisions, implementation plans, or technical ideas worth stress-testing.

$ARGUMENTS

Find every weakness, hidden assumption, and failure mode. Be concrete and constructive.
