# Documentation

## Foundational

Cross-cutting principles that apply everywhere:

- **CODING_STANDARDS.md** - Clean code, SOLID, readability
- **TESTING_PHILOSOPHY.md** - Test hierarchy, BDD workflow
- **RELEASES.md** - release-please components, breaking-change scope, version pinning

## Language & Framework Specific

- **best_practices/** - TypeScript, React, Git, logging, repository-service conventions
- **design/** - UI design system
- **TESTING.md** - Test hierarchy, workflow, E2E patterns

## Architecture

- **adr/** - Architecture Decision Records (RBAC, event sourcing, logging, feature flags, Redis)
- **[Application feature extraction plan](plans/core-application-feature-extraction-plan.md)** - the path-to-owner map that drained `platform/app`; kept as the record of where each thing went

## Also See

- `CLAUDE.md` (root) - Project overview, common mistakes

## Writing Docs

Be token-conscious. Only document project-specific decisions, not googlable content.
