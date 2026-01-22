# Coding Standards

Write code for the next engineer, not the compiler.

## Clean Code

**Readability is correctness.** Code is read 10x more than it's written. Optimize for understanding.

- **Names reveal intent.** `getUserById` not `get`, `isValidEmail` not `check`
- **Functions do one thing.** If you need "and" to describe it, split it
- **Small functions.** Extract until you can't name the extraction meaningfully
- **No side effects.** A function named `validate` shouldn't also modify state
- **Comments explain why, not what.** Code tells you what; comments tell you why it's weird

## SOLID

| Principle | One-liner |
|-----------|-----------|
| **S**ingle Responsibility | One reason to change |
| **O**pen/Closed | Extend behavior without modifying existing code |
| **L**iskov Substitution | Subtypes must be substitutable for their base types |
| **I**nterface Segregation | Don't force clients to depend on methods they don't use |
| **D**ependency Inversion | Depend on abstractions, not concretions |

## Code Smells

Stop and refactor when you see:

- **Long parameter lists** — group into objects
- **Feature envy** — method uses another class's data more than its own
- **Primitive obsession** — use domain types (`Email`, `UserId`) not raw strings
- **Shotgun surgery** — one change requires edits across many files
- **Duplicate code** — three occurrences is the threshold for extraction

## The Boy Scout Rule

Leave the code cleaner than you found it. Small improvements compound.

## When in Doubt

1. Can a new team member understand this in 30 seconds?
2. Will this be obvious in 6 months?
3. Does this make the codebase simpler or more complex?

If the answer is no, refactor before moving on.
