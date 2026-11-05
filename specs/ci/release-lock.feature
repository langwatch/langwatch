Feature: A Python package release keeps uv.lock in step
  As a maintainer cutting a release of a uv workspace Python package
  I want the root uv.lock to carry the released version
  So that CI does not relock and fail on a dirty git diff

  # release-please bumped sdks/python/pyproject.toml but not the editable
  # langwatch entry in the root uv.lock. The openapi-clients job relocks,
  # sees a diff and fails. That blocked the 2.0.0 release.

  Background:
    Given the repository's release-please config and root uv.lock

  @unit
  Scenario: The release config bumps uv.lock
    Given a uv workspace package in the release-please config
    Then it has exactly one toml extra-files entry for its own /uv.lock package

  @unit
  Scenario: A lock behind the release version fails the check
    Given the package entry in uv.lock differs from pyproject.toml or the release manifest
    Then the guard fails and names both versions
    And it tells the developer to run `uv lock` only when pyproject.toml equals the release manifest and the lock differs

  @unit
  Scenario: A lock in step passes
    Given every package entry in uv.lock matches its pyproject.toml and the release manifest
    Then the guard reports no problem

  @unit
  Scenario: A pyproject without a static project version fails the check
    Given a package pyproject.toml has no static version under [project]
    Then the guard says there is no static [project] version

  @unit
  Scenario: A ksuid-python release that leaves the lock behind fails the check
    Given packages/ksuid-python is released and the langwatch-ksuid entry in uv.lock is behind
    Then the guard fails for packages/ksuid-python only

  @unit
  Scenario: A uv workspace member the guard does not check fails the check
    Given the root pyproject.toml lists a uv workspace member the guard does not know
    Then the guard fails and names the member

  @unit
  Scenario: The guard reads the repository files
    Given a repository root holding the config, manifest, pyprojects and uv.lock
    Then the guard reads them from disk and reports the problems in them

  @unit
  Scenario: Manifest drift is reported without lock advice
    Given pyproject.toml and the release manifest disagree, whatever the lock holds
    Then the guard reports only that drift, with both versions
    And it does not tell the developer to run `uv lock`

  @unit
  Scenario: A package missing from the release manifest fails the check
    Given the release manifest has no key for a workspace package
    Then the guard says the key is missing

  @unit
  Scenario: A missing uv.lock entry fails with uv lock advice
    Given uv.lock holds no entry for a workspace package
    Then the guard says there is no such entry and to run `uv lock`

  @unit
  Scenario: A duplicate uv.lock entry fails without uv lock advice
    Given uv.lock holds two entries for a workspace package
    Then the guard reports the count and does not suggest `uv lock`

  @unit
  Scenario: A non-editable uv.lock entry fails the check
    Given the uv.lock entry for a workspace package is not its editable source
    Then the guard says it is not the editable package and does not suggest `uv lock`

  @unit
  Scenario: A multi-line workspace members list fails the check
    Given the root pyproject.toml writes its uv workspace members over several lines
    Then the guard says it cannot read the members list
