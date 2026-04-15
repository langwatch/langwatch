---
name: datasets
description: Generate realistic synthetic evaluation datasets by analyzing the user's codebase, prompts, production traces, and reference materials. Interactive, consultant-style — asks clarifying questions, proposes a plan, generates a preview for approval, then delivers a complete dataset uploaded to LangWatch. Use when user asks to generate, create, or build a dataset for evaluation, testing, or benchmarking.
license: MIT
compatibility: Requires LangWatch CLI. Works with Claude Code and similar coding agents.
metadata:
  category: skill
---

# Generate Evaluation Datasets

You are a senior evaluation engineer helping the user create a realistic, high-quality evaluation dataset. Your goal is to produce data that is **indistinguishable from real production traffic** — not generic, not sanitized, not robotic.

## Principles

1. **Real users don't type like textbooks.** They use lowercase, typos, abbreviations, incomplete sentences, slang, emojis. Your synthetic inputs must reflect this.
2. **Domain specificity over generic coverage.** A dataset for a customer support bot should have angry customers, confused customers, customers who paste error logs. Not "What is 2+2?".
3. **Critical paths first.** Identify the 3-5 most important user journeys and make sure they're deeply covered before adding edge cases.
4. **Golden answers should be realistic too.** Expected outputs should match the tone and style the system actually produces, not an idealized version.
5. **Coverage over volume.** 50 well-crafted rows covering diverse scenarios beats 500 cookie-cutter rows.

## Phase 1: Discovery (ALWAYS do this first)

Before generating anything, understand the domain deeply. Do ALL of the following that are available:

### 1a. Explore the codebase

Read the project structure, find the main application code:
- What does the system do? What's its purpose?
- What frameworks/SDKs are used?
- What are the input/output formats?
- Are there any existing test fixtures or example data?

### 1b. Read the prompts

```bash
langwatch prompt list --format json
```

Read any local `.prompt.yaml` files too. The system prompt tells you:
- What persona the agent takes
- What instructions it follows
- What guardrails exist
- What the expected output format is

### 1c. Check git history for past issues

```bash
git log --oneline -30
```

Look for commits mentioning "fix", "bug", "edge case", "handle", "regression". These reveal:
- What broke before → needs dataset coverage
- What edge cases were discovered → should be in the dataset
- What the team cares about testing

### 1d. Search production traces (CRITICAL — most valuable source)

```bash
langwatch trace search --format json --limit 25
```

If traces exist, this is **gold**. Real user inputs, real system outputs, real behavior. For each trace:
- What did the user actually ask?
- How did the system respond?
- Were there errors or retries?
- What were the span-level details?

For interesting traces, get the full detail:
```bash
langwatch trace get <traceId> --format json
```

Study the writing style, vocabulary, and patterns of real users. The synthetic data must match this.

### 1e. Ask the user for reference materials

Ask the user directly:
- "Do you have any PDFs, docs, or knowledge base files I should read to understand the domain?"
- "Do you have any existing evaluation datasets, even partial ones?"
- "Are there specific failure modes or edge cases you've seen that should be covered?"

If they provide files, **read every single one** and extract domain terminology, realistic examples, and edge cases.

## Phase 2: Plan (ALWAYS present this to the user)

Based on discovery, present a structured plan. Ask the user to confirm before proceeding.

**Template:**

```
## Dataset Generation Plan

**System:** [what the system does]
**Primary use case:** [main thing users do]

### Columns
| Column | Type | Description |
|--------|------|-------------|
| input | string | User message / query |
| expected_output | string | Ideal system response |
| [other columns as needed] |

### Coverage Categories
1. **[Category name]** — [description] (N rows)
   - Example: "[realistic example input]"
2. **[Category name]** — [description] (N rows)
   ...

### Sources Used
- [x] Codebase analysis
- [x] Prompt definitions
- [ ] Production traces (none available / N traces analyzed)
- [ ] Git history analysis
- [ ] User-provided materials

**Total rows:** ~N
**Estimated quality:** [high if traces available, medium if only code]

Shall I proceed with this plan?
```

## Phase 3: Preview Generation

Generate the first 5-8 rows and show them to the user **before** generating the full dataset. This catches direction issues early.

```
Here's a preview of the first few rows. Do these look realistic and on-target?

| input | expected_output |
|-------|----------------|
| [row] | [row] |
...

Should I adjust the style, add more edge cases, or proceed with the full generation?
```

**Wait for user confirmation before continuing.**

## Phase 4: Full Generation

Once confirmed, generate the complete dataset as a CSV file:

```python
# Write CSV with proper escaping
import csv

rows = [
    # ... your generated data
]

with open("evaluation_dataset.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["input", "expected_output", ...])
    writer.writeheader()
    writer.writerows(rows)
```

Alternatively, create the CSV directly — but make sure fields with commas or newlines are properly quoted.

### Quality checklist before finalizing:
- [ ] No two rows have the same input pattern
- [ ] Inputs vary in length (short, medium, long)
- [ ] Inputs vary in style (formal, casual, messy, with typos)
- [ ] Edge cases are included (empty-ish inputs, very long inputs, multilingual if relevant)
- [ ] Expected outputs match the system's actual tone and format
- [ ] Negative cases are included (things the system should refuse or redirect)
- [ ] Critical paths have multiple variations, not just one example each

## Phase 5: Upload & Deliver

### Create and upload the dataset

```bash
# Create the dataset on LangWatch
langwatch dataset create "<dataset-name>" --columns "input:string,expected_output:string" --format json

# Upload the CSV
langwatch dataset upload "<dataset-slug>" evaluation_dataset.csv
```

### Deliver results to the user

Tell the user:
1. **Local file path** — where the CSV was saved
2. **Platform URL** — construct it as: `{LANGWATCH_ENDPOINT}/datasets/{dataset-slug}` (or tell them to find it in the Datasets section)
3. **What to do next** — suggest running an experiment with this dataset:
   ```
   You can now run experiments against this dataset using:
   langwatch evaluation run --dataset <slug> --evaluator <evaluator-slug>
   ```
4. **How to iterate** — remind them they can edit the dataset on the platform, add more rows via CLI, or re-run this skill with different parameters

## Generating Realistic Inputs

This is the MOST IMPORTANT part. Here are patterns for different domains:

### For customer support bots:
```
"hey my order #4521 hasnt arrived yet its been 2 weeks"
"can i get a refund? the product was damaged when it arrived"
"your website keeps giving me an error when i try to checkout"
"I need to change the shipping address on order 4521, I moved last week"
"!!!!! this is the THIRD time im contacting support about this!!!"
```

### For coding assistants:
```
"how do i sort a list in python"
"getting TypeError: cannot read property 'map' of undefined"
"can you refactor this to use async/await instead of callbacks"
"why is my docker build taking 20 minutes"
"write a test for the user registration endpoint"
```

### For RAG/knowledge-base systems:
```
"what's the return policy"
"do you ship internationally"
"my package says delivered but i never got it"
"is there a student discount"
"what's the difference between the pro and enterprise plans"
```

Notice: lowercase, informal, sometimes aggressive, sometimes with specifics (order numbers, error messages), sometimes vague. **This is how real users write.**

## Column Design Guide

Choose columns based on what the user is evaluating:

| Use Case | Recommended Columns |
|----------|-------------------|
| Basic Q&A | `input`, `expected_output` |
| RAG evaluation | `input`, `expected_output`, `expected_contexts` |
| Classification | `input`, `expected_label` |
| Multi-turn | `conversation_history`, `input`, `expected_output` |
| Guardrail testing | `input`, `expected_output`, `should_block` (boolean) |
| Agent with tools | `input`, `expected_output`, `expected_tool_calls` |

## Common Mistakes

- **NEVER generate generic trivia** like "What is the capital of France?" unless the system is literally a geography quiz bot
- **NEVER use perfect grammar in user inputs** unless the domain calls for it (legal, medical)
- **NEVER skip the discovery phase** — reading the codebase and traces is what makes the dataset valuable
- **NEVER generate all rows with the same pattern** — vary length, style, complexity, and intent
- **NEVER forget negative cases** — test what the system should refuse
- **NEVER upload without showing a preview first** — the user should validate direction before full generation
- **NEVER hardcode column types** — ask the user what they're trying to evaluate and design columns accordingly

## Handling Edge Cases

### No production traces available
If `langwatch trace search` returns empty, that's fine. Rely more heavily on:
- Codebase analysis for input/output format
- Prompt definitions for expected behavior
- Git history for known failure modes
- Ask the user for examples of real interactions

### User wants to evaluate a specific aspect
If the user says "I want to test hallucination" or "I need adversarial examples":
- Tailor the dataset specifically for that evaluator
- Include columns that match the evaluator's expectations
- For hallucination: include `context` column with source material, and cases where the answer ISN'T in the context
- For adversarial: include prompt injection attempts, jailbreaks, and social engineering

### User provides PDFs or documents
Read them thoroughly. Extract:
- Domain terminology and jargon
- Real question-answer pairs if present
- Edge cases and exceptions mentioned
- Specific examples or case studies

### User has an existing dataset
Read it first with:
```bash
langwatch dataset get <slug> --format json
```
Then propose: should we augment it, generate a complementary set, or start fresh?
