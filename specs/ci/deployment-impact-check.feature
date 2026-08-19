Feature: Deployment impact gate skips manifest-only dependency bumps
  The deployment-impact-check workflow fails a PR that touches charts/,
  services/, ADRs, best-practices docs, .env.example, or self-hosting docs
  without a filled-in "## Deployment Impact" section. Its `services/**`
  trigger path matches every dependency-manifest bump under
  services/langevals, services/aigateway, and services/nlpgo too, but a pure
  lockfile/manifest diff cannot add an env var, a helm value, or change
  `helm install` behavior — it has no deployment surface by construction.
  Dependabot never writes that section, so this recurring false positive
  blocked every services/* dependency PR from merging.

  Background:
    Given a pull request whose head repo matches the target repo
    And the branch is not a release-please branch

  Scenario: PR only touches dependency manifests and lockfiles
    Given the PR's changed files are all uv.lock, pyproject.toml,
      package.json, pnpm-lock.yaml, go.mod, go.sum, Cargo.lock, Cargo.toml,
      or requirements*.txt
    And the PR touches a path under services/**
    And the PR description has no "## Deployment Impact" section
    When deployment-impact-check runs
    Then the check passes without requiring the section

  Scenario: PR touches a real deployment-relevant file
    Given the PR's changed files include a Dockerfile under services/**
    And the PR description has no "## Deployment Impact" section
    When deployment-impact-check runs
    Then the check fails and requests the section

  Scenario: PR mixes a manifest bump with a real file change
    Given the PR's changed files include both uv.lock and a chart template
      under charts/**
    And the PR description has no "## Deployment Impact" section
    When deployment-impact-check runs
    Then the check fails and requests the section
