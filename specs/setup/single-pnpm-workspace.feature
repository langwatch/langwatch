Feature: Single pnpm workspace for the whole repository
  Every TypeScript package in the monorepo — the platform app, its internal
  packages, the published SDK, the MCP server, the installer CLI, skills and
  the agentic e2e suite — resolves out of one workspace with one lockfile,
  so dependency management, deduplication and security overrides happen in
  exactly one place.

  Background:
    Given the workspace root is the repository root
    And pnpm-workspace.yaml lists the app, its packages, the SDK, the MCP server, the installer packages, skills and the agentic e2e suite

  Scenario: One lockfile serves every package
    When dependencies are installed from any package directory
    Then the single root pnpm-lock.yaml is used
    And no package carries its own lockfile or workspace file

  Scenario: Packages are addressed by name with filtering
    When a developer runs a script for one package
    Then pnpm --filter selects it by package name
    And the app is named "@langwatch/app" so it cannot collide with the published "langwatch" SDK

  Scenario: The app depends on the published SDK, not the in-repo one
    Given the app declares a released version of the "langwatch" SDK
    When dependencies are installed
    Then the app resolves the SDK from the registry
    And the in-repo SDK at sdks/typescript is not linked in its place

  Scenario: Overrides and install policy live only at the root
    Given security overrides and the release-age gate are defined in the root pnpm-workspace.yaml
    When any package resolves dependencies
    Then the root settings apply to it
    And pnpm sections inside member manifests are not consulted

  Scenario: The npx installer ships the workspace root
    Given the @langwatch/server tarball ships the root workspace manifest and lockfile
    When a user boots the server for the first time
    Then dependencies install at the shipped tree's root against the shipped lockfile
    And workspace members absent from the tarball are skipped without error

  Scenario: Docker images install from the workspace root
    Given the app image build copies the root workspace manifests
    When the image installs dependencies with a frozen lockfile
    Then the app, its internal packages and the MCP server all resolve
    And the runtime stage carries the shared virtual store alongside the app
