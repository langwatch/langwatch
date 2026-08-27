# .claude/

Project-specific Claude Code configuration for LangWatch.

## Structure

```
.claude/
├── settings.json             # Shared Claude Code project settings
├── skills/
│   ├── browser-pair/         # Claude-specific browser pairing workflow
│   ├── browser-test/         # Claude-specific browser test workflow
│   ├── code-review/          # Claude-specific code review workflow
│   ├── feature-map/          # Claude-specific feature-map workflow
│   ├── haven-setup/          # Haven environment setup workflow
│   ├── langwatch-kanban/     # Manage LangWatch GitHub project board
│   ├── chakra-ui-builder -> ../../.agents/skills/chakra-ui-builder
│   ├── chakra-ui-migrate -> ../../.agents/skills/chakra-ui-migrate
│   └── chakra-ui-refactor -> ../../.agents/skills/chakra-ui-refactor
└── README.md
```

The Chakra UI entries are symlinks to the shared repository-agent skills under
`.agents/skills/`; keep one source for those instructions. The other entries
are Claude-specific workflows and remain separate from both the product skill
compiler under `skills/` and the repository guidance in `.agents/skills/`.
