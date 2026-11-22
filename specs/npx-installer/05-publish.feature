Feature: CI smoke + publish for `@langwatch/server`
  As the LangWatch maintainers
  I want every release tag to ship a verified npm package
  So that `npx @langwatch/server` always points at the same version as helm/docker

  See _shared/contract.md §9 (CI matrix), §10 (publish), §11 (rip-out).
  See ../../dev/docs/adr/180-npx-server-downloads-a-prebuilt-app.md: the npm
  package is the CLI and the app ships as a prebuilt archive per platform.

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

  Scenario: Smoke proves the artifacts users receive, never the checkout
    Given the smoke job packed the npm package and built the app archive
    When the smoke boots the server
    Then everything that runs came from that package and that archive
    And a file missing from the archive fails the smoke even though the checkout has it
    # A checkout boot masks packaging gaps: an over-broad prune breaks only the
    # released archive, which no CI step would otherwise execute.

  Scenario: A fresh install from the published artifacts boots with nothing missing
    When a user installs from the published package and its app archive
    Then the server reaches healthy with every module the app imports present
    And the publish job refuses to ship an archive that would not

  Scenario: An incomplete app archive fails the publish, not a user's first boot
    Given an app archive missing packages the app needs
    When the publish job checks it
    Then no link inside it may point at a missing directory
    And the publish fails before anything reaches npm

  Scenario: Smoke job uploads logs as artifact on failure
    Given a smoke job step fails
    Then "~/.langwatch/logs/" is uploaded as workflow artifact "logs-<runner>-<sha>.tar.gz"
    And the failed step's stderr is annotated to the GH Actions summary

  Scenario: Smoke job triggers
    Given the smoke workflow file is "/.github/workflows/npx-server-smoke.yml"
    Then it triggers on:
      | trigger           | detail                                                                    |
      | workflow_dispatch | manual                                                                    |
      | workflow_call     | from the nightly suite, .github/workflows/nightly.yml (01:00 UTC)        |
      | push paths        | package.json, pnpm-workspace.yaml, apps/server/**                         |
      | push paths        | langwatch_nlp/pyproject.toml, services/langevals/**/pyproject.toml        |
      | push paths        | services/aigateway/**, cmd/service/**                                     |
      | push paths        | apps/api/package.json, apps/worker/package.json                           |

  # =========================================================================
  # Publish job
  # =========================================================================

  Scenario: Publish triggers on the main langwatch release tag
    Given the existing release-langwatch-chart workflow already keys off "release.published"
    When a release tagged "v3.1.1" is published
    Then "/.github/workflows/npx-server-publish.yml" runs
    And it publishes "@langwatch/server@3.1.1" to npm

  Scenario: Version-lock guard refuses mismatched tag and package version
    Given "apps/api/package.json" version is "3.1.1"
    But the release tag is "v3.2.0"
    When the publish job runs
    Then the job fails fast with "version mismatch: tag=v3.2.0 package.json=3.1.1"
    And nothing is published

  Scenario: Manual publish requires --force on workflow_dispatch
    When the publish workflow is dispatched manually with no input
    Then the job aborts with "set inputs.force=true to publish without a release tag"

  Scenario: Publish builds the app archives before npm pack
    Given a clean checkout
    When the publish job runs
    Then each platform's app archive is built from the production build on its own runner
    And npm publish waits for every archive
    # The archive contents, checks and size are in 09-prebuilt-app.feature.

  Scenario: The npm package carries no application source
    When the publish job packs the npm package
    Then the package holds "dist/cli.cjs", "package.json", "README.md" and "LICENSE.md" only
    And it holds no ".env", key, ".npmrc" or lockfile

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
