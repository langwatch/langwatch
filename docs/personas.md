# LangWatch Personas

One person may wear multiple hats. Each hat has distinct needs.

## Developer

**Goal:** Speed and correctness.

- Owns deployment and integration
- Uses SDK/CLI for testing
- Needs high-fidelity logs and traces
- **Pain:** Hard to communicate failures to non-technical stakeholders

## Prompt Engineer

**Goal:** Behavioral optimization.

- Semi-technical, understands LLMs
- Needs fast iteration: tweak prompt → run → see results
- **Pain:** Blocked by Dev to test changes without deployment

## Product Owner / Domain Expert

**Goal:** Behavioral correctness.

- Knows what "good" looks like
- Defines Situation and Score in natural language
- **Pain:** Blocked by engineering to add test cases

## Team Lead

**Goal:** Oversight and efficiency.

- Manages multiple agents/teams
- Needs aggregated dashboards
- **Pain:** No visibility into reliability across teams

## Collaborative Workflow

| Stage | Owner | Deliverable |
|-------|-------|-------------|
| Specification | PO | Behavioral Contract (Situation + Score) |
| Optimization | Prompt Engineer | Tuned Agent |
| Scripting | Dev | Interaction Flow |
| Integration | Dev | Runnable Scenario |
| Validation | Team Lead | Quality Guarantee |
