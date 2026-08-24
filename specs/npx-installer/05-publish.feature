Feature: CI smoke + publish for `@langwatch/server`
  As the LangWatch maintainers
  I want every release tag to ship a verified npm package
  So that `npx @langwatch/server` always points at the same version as helm/docker

  See _shared/contract.md §9 (CI matrix), §10 (publish), §11 (rip-out).
  See ../../dev/docs/adr/111-physical-application-workspaces.md for the planned
  source relocation. Physical paths below characterize the current artifact
  until that migration stage moves the manifest and staging inputs atomically;
  the public command and nested frozen-workspace behaviour remain authoritative.

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

  Scenario: Smoke proves the artifact npm users receive, never the checkout
    Given the smoke job packed the npm tarball
    When the smoke boots the server
    Then everything that runs came from that tarball
    And a file missing from the artifact fails the smoke even though the checkout has it
    # A checkout boot masks packaging gaps: an over-broad exclusion breaks
    # only the released artifact, which no CI step would otherwise execute.

  Scenario: A fresh install from the published artifact boots with nothing missing
    When a user installs from the published artifact
    Then the server reaches healthy with every module the app imports present
    And the publish job refuses to ship an artifact that would not

  Scenario: An incomplete artifact fails at install time, not minutes later at boot
    Given a published artifact missing packages the app needs
    When the installer prepares the app
    Then it fails during install, before any service starts
    And the failure names the missing packages and says the artifact itself is at fault
    And it points at the issue tracker instead of leaving the user to debug a bare module error

  Scenario: Smoke job uploads logs as artifact on failure
    Given a smoke job step fails
    Then "~/.langwatch/logs/" is uploaded as workflow artifact "logs-<runner>-<sha>.tar.gz"
    And the failed step's stderr is annotated to the GH Actions summary

  Scenario: Smoke job triggers
    Given the smoke workflow file is "/.github/workflows/npx-server-smoke.yml"
    Then it triggers on:
      | trigger           | detail                                                                    |
      | workflow_dispatch | manual                                                                    |
      | schedule          | "0 4 * * *" (nightly, UTC)                                                |
      | push paths        | package.json, pnpm-workspace.yaml, packages/server/**                     |
      | push paths        | langwatch_nlp/pyproject.toml, services/langevals/**/pyproject.toml        |
      | push paths        | services/aigateway/**, platform/app/package.json, platform/app/scripts/** |

  # =========================================================================
  # Publish job
  # =========================================================================

  Scenario: Publish triggers on the main langwatch release tag
    Given the existing release-langwatch-chart workflow already keys off "release.published"
    When a release tagged "v3.1.1" is published
    Then "/.github/workflows/npx-server-publish.yml" runs
    And it publishes "@langwatch/server@3.1.1" to npm

  Scenario: Version-lock guard refuses mismatched tag and package version
    Given "platform/app/package.json" version is "3.1.1"
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
    Then the app's production build runs before npm pack
    And the resulting tarball contains the prebuilt client at "app/langwatch/dist/client/"
    And the tarball does NOT contain "node_modules" or build caches
    # `pnpm --filter langwatch build` would be WRONG now: since ADR-076 that
    # filter selects the published TypeScript SDK. The app is @langwatch/web.

  Scenario: Tarball contains expected directories only
    # Everything ships one level down, under app/ — npm deletes a lockfile at
    # the package ROOT no matter what the manifest asks, and shipping the
    # lockfile is what keeps the end-user install reproducible. See ADR-076.
    When the publish job builds the tarball
    Then the tarball contains:
      | path                                  |
      | app/packages/server/dist/             |
      | app/pnpm-workspace.yaml               |
      | app/pnpm-lock.yaml                    |
      | app/langwatch/dist/client/            |
      | app/langwatch/public/                 |
      | app/langwatch/prisma/                 |
      | app/langevals/                        |
      | app/python-sdk/                       |
      | app/mcp-server/dist/                  |
    And the tarball does NOT contain:
      | path                       |
      | app/langwatch/node_modules |
      | app/langevals/**/.venv     |
      | **/.env                    |
      | **/.env.*                  |
      | **/*.pem                   |
      | **/.npmrc                  |
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
