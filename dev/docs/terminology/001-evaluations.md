# LangWatch Evaluations Terminology

> Purpose: Internal reference for consistent language across docs, marketing, support, and product.
>

## Core Terms

### Experiment

**Definition:** A batch test run that compares prompt/model/agent variations on a dataset before production.

**When to use:**

- Talking about systematic testing before deployment
- Comparing different configurations
- Running CI/CD quality gates

**Examples:**

- ✅ "Run an experiment to compare GPT-4 vs Claude"
- ✅ "The experiment showed a 5% improvement in faithfulness"
- ❌ "Run an evaluation" (too ambiguous)

**Platform mapping:** Experiments Workbench (formerly "Evaluations V3")

---

### Online Evaluation

**Definition:** Continuous scoring of live production traces.

**When to use:**

- Entry point in documentation (SEO-friendly term)
- Explaining production monitoring
- External communications

**Platform mapping:** Monitors

**Note:** Use "Online Evaluation" in docs headings and external comms. Use "Monitors" when referring to the specific platform feature.

**Examples:**

- ✅ "Set up online evaluation to monitor production quality"
- ✅ "Create a monitor to track faithfulness scores"
- ❌ "Real-time evaluation" (deprecated term)

---

### Monitor

**Definition:** A platform feature that runs evaluators on production traces and records scores.

**When to use:**

- Referring to the specific platform UI/feature
- Step-by-step instructions in docs
- Internal discussions

**Examples:**

- ✅ "Create a new monitor in the Evaluations page"
- ✅ "The monitor triggered 5 times today"

---

### Guardrail

**Definition:** An evaluator that runs synchronously and blocks/modifies responses in real-time.

**When to use:**

- Talking about blocking harmful content
- Enforcement and safety mechanisms
- Real-time intervention (not just measurement)

**Distinction from Monitors:**

- Monitors **measure** (async, observability)
- Guardrails **act** (sync, enforcement)

**Examples:**

- ✅ "Add a guardrail to block jailbreak attempts"
- ✅ "The guardrail prevented PII from being exposed"
- ❌ "Use a monitor to block content" (monitors don't block)

---

### Evaluator

**Definition:** A scoring function that assesses output quality. Includes both:

1. **Built-in evaluators** - LangWatch library (Faithfulness, PII Detection, etc.)
2. **Your evaluators** - Configured instances you've saved

**When to use:**

- Referring to any scoring function
- Both built-in options and custom configurations
- The mechanism that produces scores

**Examples:**

- ✅ "Use the Faithfulness evaluator"
- ✅ "Create your own evaluator using LLM-as-Judge"
- ✅ "Browse available evaluators"
- ❌ "Check" (deprecated - we don't use this term)

---

### Score

**Definition:** The result of running an evaluator.

**When to use:**

- Referring to evaluation results
- Metrics and measurements

**Examples:**

- ✅ "The faithfulness score was 0.85"
- ✅ "View scores in the trace details"

---

### Dataset

**Definition:** A collection of test cases with inputs and optional expected outputs.

**When to use:**

- Test data for experiments
- Collections used in the platform

---

## Deprecated Terms

| Don't Use | Use Instead |
| --- | --- |
| Real-time evaluation | Online evaluation (docs) / Monitors (platform) |
| Offline evaluation | Experiments |
| Evaluation Wizard | Experiments Workbench |
| Check | Evaluator |
| Evaluations V3 | Experiments Workbench |

---

## Quick Reference: What Do They Mean?

| When someone says... | They probably mean... | Clarify by asking... |
| --- | --- | --- |
| "I want to run evaluations" | Experiments or Monitors | "Do you want to test before deploying (experiment) or monitor production traffic?" |
| "I created an evaluation" | An Evaluator config or an Experiment run | "Do you mean you configured an evaluator, or you ran an experiment?" |
| "Evaluation results" | Scores | "From an experiment or from production traces?" |
| "Real-time evaluation" | Monitor or Guardrail | "Do you need to measure (monitor) or block (guardrail)?" |

---

## Language Guidelines

### DO

- Use "experiment" for batch testing
- Use "online evaluation" in docs headings, "monitors" for platform features
- Use "evaluator" for all scoring functions (built-in and custom)
- Use "guardrail" for real-time blocking
- Use "score" for results

### DON'T

- Say "run an evaluation" (ambiguous)
- Say "real-time evaluation" (use "online evaluation")
- Say "check" (use "evaluator")
- Conflate monitors and guardrails

---

## Documentation Structure

```
Testing & Quality
├── Overview
├── Experiments (batch testing)
│   ├── Overview
│   ├── Experiments Workbench
│   ├── Code-First
│   └── CI/CD
├── Online Evaluation (production scoring)
│   ├── Overview
│   ├── Setting up Monitors
│   └── By Thread
├── Guardrails (blocking)
│   ├── Overview
│   └── Code Integration
├── Evaluators (scoring functions)
│   ├── Overview
│   ├── List
│   └── Custom Evaluators
└── Datasets

```

---

## Changelog

- **2024-12-16**: Initial terminology guide created
    - Adopted "Experiments" for batch testing (industry standard)
    - Adopted "Online Evaluation" for docs, "Monitors" for platform
    - Deprecated "Real-time evaluation", "Evaluation Wizard", "Check"
    - Unified "Evaluator" to cover both built-in and custom configs