---
name: challenge
description: "Stress-test an architecture proposal, plan, or technical idea. Invokes the devils-advocate agent to find weaknesses before you commit."
context: conversation
agent: devils-advocate
user-invocable: true
argument-hint: "[proposal or plan to challenge]"
---

Challenge the proposal below. Focus ONLY on what is presented — do not explore the codebase, search for other issues, or expand scope beyond what is being proposed.

$ARGUMENTS

Find weaknesses, hidden assumptions, and failure modes in this specific proposal. Be concrete and constructive. Do not suggest alternative architectures unless a flaw demands it.
