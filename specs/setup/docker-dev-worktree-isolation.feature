Feature: Docker dev environment worktree isolation and startup speed
  As a developer working in multiple git worktrees
  I want each worktree to have isolated Docker containers and dependencies
  So that parallel development work doesn't interfere

  Background:
    Given the Docker dev environment is configured via compose.dev.yml
    And scripts/dev.sh provides an interactive launcher

  @integration
  Scenario: Two worktrees have isolated node_modules
    Given worktree A is on branch with dependency X@1.0
    And worktree B is on branch with dependency X@2.0
    When both run make quickstart
    Then each has its own node_modules with the correct dependency version
    And the shared pnpm store caches packages for both

  @integration
  Scenario: Worktree containers don't collide
    Given dev.sh is run from a git worktree named "issue123-my-feature"
    When Docker containers start
    Then COMPOSE_PROJECT_NAME is set to "issue123-my-feature"
    And containers are namespaced separately from the main checkout

  @integration
  Scenario: Restart skips unnecessary init work
    Given a worktree that has already run make quickstart
    When make quickstart is run again with no dependency changes
    Then init skips pnpm install (lockfile hash matches)
    And prisma generate and types:zod:generate still run

  @unit
  Scenario: Rebuild command works correctly
    Given the rebuild option is selected in dev.sh
    When rebuild runs
    Then it does not reference stale volume names
    And node_modules are cleaned via the bind-mount directory

  @unit
  Scenario: Port scan starts at correct base ports
    Given dev.sh scans for free ports
    Then APP_PORT scanning starts at 5560
    And BULLBOARD_PORT scanning starts at 6380
    And AI_SERVER_PORT scanning starts at 3456

  @unit
  Scenario: Corepack enable is not repeated per container
    Given a custom base image extends node:24 with corepack enabled
    When services start using the custom image
    Then no service command includes "corepack enable"

  @unit
  Scenario: Environment variables are not duplicated across services
    Given compose.dev.yml uses YAML anchors for shared env vars
    Then DATABASE_URL is defined once in x-common-env
    And REDIS_URL is defined once in x-common-env
    And services merge the anchor with service-specific overrides
