# .claude/

Project-specific Claude Code configuration for LangWatch.

## Structure

```
.claude/
├── settings.json             # Shared Claude Code project settings
├── skills/
│   ├── architecture-guide/   # The repository layout reference (contract/server/web, config, install, testing)
│   ├── browser-pair/         # Claude-specific browser pairing workflow
│   ├── browser-test/         # Claude-specific browser test workflow
│   ├── chakra-ui-builder/    # Build UI with Chakra UI v3
│   ├── chakra-ui-migrate/    # Migrate a project from Chakra UI v2 to v3
│   ├── chakra-ui-refactor/   # Review and convert UI code to Chakra UI v3
│   ├── design-system/        # Where LangWatch's components, tokens and Chakra setup live
│   ├── feature-map/          # Claude-specific feature-map workflow
│   ├── haven-setup/          # Haven environment setup workflow
│   ├── langwatch-kanban/     # Manage LangWatch GitHub project board
│   ├── lint-rule/            # Add or change a langwatch oxlint rule
│   ├── mail-template/        # Add or change a transactional email
│   ├── module/                # Build or change a module: new, extend, convert, wire, move, web-surface
│   ├── module-review/         # Audit a module, a directory, a diff or a branch, and for over-abstraction
│   └── spec-bind/            # Bind a Gherkin scenario to the test that proves it
└── README.md
```

This is the one skills directory for the repository. `.agents/skills` is a relative
symlink to `skills/` above, kept only so tooling that discovers skills at the older
location still finds the same files. There is nothing under `.agents/skills` that is
not here.
