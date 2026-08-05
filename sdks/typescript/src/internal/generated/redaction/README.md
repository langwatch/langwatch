# Verbatim mirror of @langwatch/redaction

The canonical redaction engine lives at `packages/redaction` and is
workspace-imported by the app and the MCP server. This directory is a
byte-for-byte copy of its sources for the CLI, not a fork.

Why a copy instead of an import: the repo has two disjoint pnpm workspaces,
and `typescript-sdk` (published standalone to npm as `langwatch`) cannot
declare a workspace dependency on `packages/*`. Publishing
`@langwatch/redaction` to npm would make it importable, but adds a second
published package and a release-ordering coupling (redaction must publish
before every CLI release that touches it) for identical shipped behavior. So
the CLI takes the repo's existing seam for SDK and app sharing: a generated
mirror.

Rules:

- Never edit these files here. Edit `packages/redaction/src` and run
  `./copy-types.sh` from `typescript-sdk/`.
- `src/cli/commands/__tests__/report-redaction-drift.unit.test.ts` pins each
  file byte-for-byte against the canonical package, so drift fails CI.
- `REDACTION_AUDIT_URL` (printed by `langwatch report --help`) sends auditing
  agents to the canonical file on GitHub. The byte-equality test is what makes
  that link an honest description of what this bundle executes.
