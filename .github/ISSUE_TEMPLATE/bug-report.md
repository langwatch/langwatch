---
name: 🐛 Bug Report
about: Report a bug or unexpected behavior
title: ""
type: Bug
projects: ["5"]
assignees: ""
---

**Impact**

- Severity: [P0 - critical / P1 - high / P2 / P3] and why
- Who is affected: [which users, projects, or components; how many if known]
- Since when: [first seen / version / date]
- Workaround: [what the user can do today, or "none"]

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps to reproduce the behavior:

1. Go to '...'
2. Click on '....'
3. See error

**Evidence**
Logs, screenshots, queries, or event ids that show the failure. Link, don't paste secrets.

**Expected behaviour as acceptance criteria**

- Given [context], when [action], then [expected outcome]
- Given [context], when [action], then [expected outcome]

**Definition of Done**

- [ ] Regression scenario in a `specs/**/*.feature` file tagged `@unit`/`@integration`/`@e2e`
- [ ] Scenario binds via `/** @scenario`
- [ ] Tests pass (regression fails without the fix)
- [ ] Use-proof embedded in the PR (see `dev/docs/TESTING_PHILOSOPHY.md#use-proof`)
- [ ] Docs updated if needed

See `specs/README.md` for feature file binding.

**Environment**

- Component: [langwatch/langwatch_nlp/langwatch_mcp_server/langwatch_sdk_python/langwatch_sdk_typescript/langwatch_sdk_go]
- Version: [e.g. v1.2.3]
- Browser/OS: [if applicable]

**Additional context**
Add any other context about the problem here.
