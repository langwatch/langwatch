---
name: challenge
description: "Stress-test an architecture proposal, plan, or technical idea. Invokes the devils-advocate agent to find weaknesses before you commit."
context: conversation
agent: devils-advocate
user-invocable: true
argument-hint: "[proposal or plan to challenge]"
---

Challenge the proposal below. You may explore the codebase to verify claims and find real conflicts, but stay focused on evaluating the proposal — do not expand scope to unrelated issues.

$ARGUMENTS

## How to Challenge

### 1. Root-Cause Check (5 Whys)
Before critiquing the solution, question the problem. Ask "why?" repeatedly until you reach the root cause:
- Is this proposal solving the actual problem, or a symptom?
- Could a different framing of the problem lead to a simpler solution?
- What triggered this proposal — is that trigger the real issue?

### 2. Find Weaknesses
- Hidden assumptions that could break under different conditions
- Failure modes — what happens when things go wrong?
- Scaling, performance, or maintenance risks
- Gaps between what the proposal claims and what the code actually supports

### 3. Be Constructive
- Be concrete: point to specific scenarios, not vague concerns
- Only suggest alternatives when a flaw demands it
- Distinguish fatal flaws from minor concerns
