# browser-types

Hand-written type declarations for packages whose published types describe a
server shape the browser never sees. The browser tsconfigs point `paths` at the
files here, so the checker reads this contract instead of the package's own
`.d.ts`; Vite still resolves the real package at runtime.

It is a bare directory rather than a workspace package on purpose — nothing
imports it by name, and the only consumers are `paths` entries in
`apps/ui/tsconfig.json` and `modules/auth/web/tsconfig.json`.

`packages/lint-core/src/rules/web-imports-server-shaped-value.rule.mjs` is the
rule that makes the two better-auth client entrypoints an allowed exception,
and `specs/tooling/browser-better-auth-contract.feature` is the spec.
