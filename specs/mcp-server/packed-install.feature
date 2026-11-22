Feature: The published MCP server installs and starts as users run it

  Users start the server with `npx @langwatch/mcp-server`, which installs the
  tarball from the public npm registry. Every other test runs inside the
  monorepo, where workspace links resolve packages npm has never had and
  vitest supplies a `require` the shipped ES module lacks. Both gaps shipped
  broken releases: 2.1.0 crashed on `--http` with `Dynamic require of "tty"`,
  and 2.2.0 and 3.0.0 listed the private `@langwatch/evaluator-contract` as a
  dependency, so every install failed with a 404.

  So the package is packed as `pnpm publish` packs it, installed into an
  empty folder from the public registry, and started there. This runs in CI
  after the build and in the release job before publishing.

  Background:
    Given the package is packed as publish packs it
    And the tarball is installed into an empty folder from the public npm registry

  @e2e
  Scenario: Every runtime dependency installs from the public registry
    Then the install succeeds

  @e2e
  Scenario: The installed server answers over stdio
    When the installed binary starts with no flags
    And it is sent an MCP initialize request
    Then it answers with its server info

  @e2e
  Scenario: The installed server starts in HTTP mode
    When the installed binary starts with `--http` on a free port
    Then its health route reports ok

  @e2e
  Scenario: The library entries load through both doors of the exports map
    When `create-mcp-server` and `config` are loaded with `import` and with `require`
    Then each of them loads
