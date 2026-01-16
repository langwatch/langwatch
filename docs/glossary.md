# LangWatch Glossary

## Core Objects

| Term | Definition |
|------|------------|
| **Scenario** | Behavioral spec: Situation + Script + Score |
| **Target** | What's being tested: Prompt or Agent |
| **Agent** | Execution unit: Code, Workflow, or HTTP endpoint |
| **Suite** | Execution recipe: scenarios × targets × settings |
| **Run** | Historical record of a simulation |

## Scenario Anatomy

| Part | Definition |
|------|------------|
| **Situation** | Context describing user, state, and goal |
| **Script** | Interaction flow (auto-simulated or manual) |
| **Score** | Success criteria for judgment |

## Execution

| Term | Definition |
|------|------------|
| **User Simulator** | LLM that generates user turns |
| **Judge** | LLM that evaluates against criteria |

## Run Modes

| Mode | Description |
|------|-------------|
| **Single** | Run once |
| **Repeat** | Run N times for confidence |
| **Dataset** | Run per row, inject context |

## Authoring Modes

| Mode | Description |
|------|-------------|
| **Contract** | PM-friendly: Situation + Score only |
| **Engineering** | Dev-friendly: full Script control |

## Scenarios vs Evaluations

| Aspect | Evaluation | Simulation |
|--------|------------|------------|
| Input | Existing dataset | Scenario spec |
| Interaction | None (static) | Dynamic conversation |
| Use Case | "Does output match?" | "Does agent behave?" |
