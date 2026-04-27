Feature: CI smoke + publish for `@langwatch/server`
  As the LangWatch maintainers
  I want every release tag to ship a verified npm package
  So that `npx @langwatch/server` always points at the same version as helm/docker

  See _shared/contract.md §9 (CI matrix), §10 (publish), §11 (rip-out).

  # =========================================================================
  # Smoke matrix
  # =========================================================================

  Scenario Outline: Smoke job boots `npx @langwatch/server` on each supported OS+arch
    Given the runner is "<runner>"
    When the smoke job builds the package and runs it from a tarball in a sandbox
    Then within 300 seconds, "/api/health" returns 200
    And the workflow + evaluator + AI Gateway probes from validation feature pass
    And the job tears down cleanly with exit code 0

    Examples:
      | runner               |
      | macos-latest         |
      | ubuntu-22.04         |
      | ubuntu-22.04-arm     |

  Scenario: Smoke job uploads logs as artifact on failure
    Given a smoke job step fails
    Then "~/.langwatch/logs/" is uploaded as workflow artifact "logs-<runner>-<sha>.tar.gz"
    And the failed step's stderr is annotated to the GH Actions summary

  Scenario: Smoke job triggers
    Given the smoke workflow file is "/.github/workflows/npx-server-smoke.yml"
    Then it triggers on:
      | trigger                   | detail                                                                 |
      | workflow_dispatch         | manual                                                                 |
      | schedule                  | "0 4 * * *" (nightly, UTC)                                             |
      | push paths                | package.json, pnpm-workspace.yaml, packages/server/**                   |
      | push paths                | langwatch_nlp/pyproject.toml, langevals/**/pyproject.toml               |
      | push paths                | services/aigateway/**, langwatch/package.json, langwatch/scripts/**     |

  # =========================================================================
  # Publish job
  # =========================================================================

  Scenario: Publish triggers on the main langwatch release tag
    Given the existing release-langwatch-chart workflow already keys off "release.published"
    When a release tagged "v3.1.1" is published
    Then "/.github/workflows/npx-server-publish.yml" runs
    And it publishes "@langwatch/server@3.1.1" to npm

  Scenario: Version-lock guard refuses mismatched tag and package version
    Given "langwatch/package.json" version is "3.1.1"
    But the release tag is "v3.2.0"
    When the publish job runs
    Then the job fails fast with "version mismatch: tag=v3.2.0 package.json=3.1.1"
    And nothing is published

  Scenario: Manual publish requires --force on workflow_dispatch
    When the publish workflow is dispatched manually with no input
    Then the job aborts with "set inputs.force=true to publish without a release tag"

  Scenario: Publish builds the langwatch app first
    Given a clean checkout
    When the publish job runs
    Then "pnpm --filter langwatch build" runs before npm pack
    And the resulting tarball contains "langwatch/.next/standalone/server.js"
    And the tarball does NOT contain "langwatch/.next/cache" or "node_modules/.cache"

  Scenario: Tarball contains expected directories only
    When the publish job builds the tarball
    Then the tarball contains:
      | path                                  |
      | bin/langwatch-server.mjs              |
      | dist/                                 |
      | langwatch/.next/standalone/           |
      | langwatch/public/                     |
      | langwatch/prisma/                     |
      | langwatch_nlp/                        |
      | langevals/                            |
      | scripts/clickhouse-migrations/        |
    And the tarball does NOT contain:
      | path                       |
      | langwatch/node_modules     |
      | langwatch_nlp/.venv        |
      | langevals/**/.venv         |
      | langwatch/.next/cache      |
      | **/.env                    |
      | **/__pycache__             |

  Scenario: Tarball gzipped size is under 300 MB
    When the publish job builds the tarball
    Then "tar tzf <tarball> | wc -l" is under 50000
    And the gzipped size is under 300 MB

  # =========================================================================
  # Rip-out: legacy uvx publish path is gone
  # =========================================================================

  Scenario: The legacy PyPI publish workflow is removed
    Then "/.github/workflows/langwatch-server-publish.yml" does not exist

  Scenario: The legacy hatchling build is removed
    Then "/pyproject.toml" does not exist
    And "/build_hooks.py" does not exist
    And "/bin/cli.py" does not exist
    And "/uv.lock" does not exist
    But "/langwatch_nlp/uv.lock" still exists
    And "/langevals/langevals_core/uv.lock" still exists

  Scenario: Makefile no longer references python-build / python-install / start
    Then "make python-build" prints "no rule"
    And "make python-install" prints "no rule"
    And "make start" prints "no rule"
    But "make dev", "make dev-full", "make service" still work

  # =========================================================================
  # Provenance + signature
  # =========================================================================

  Scenario: Published packages carry npm provenance
    When `@langwatch/server` is published
    Then the npm registry shows a provenance attestation linking to the GH workflow run
    And `npm view @langwatch/server --json | jq .dist.signatures` shows a valid signature
