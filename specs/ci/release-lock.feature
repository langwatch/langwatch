Feature: A Python SDK release keeps uv.lock in step
  As a maintainer cutting a Python SDK release
  I want the root uv.lock to carry the released version
  So that CI does not relock and fail on a dirty git diff

  # release-please bumped sdks/python/pyproject.toml but not the editable
  # langwatch entry in the root uv.lock. The openapi-clients job relocks,
  # sees a diff and fails. That blocked the 2.0.0 release.

  Background:
    Given the repository's release-please config and root uv.lock

  @unit
  Scenario: The release config bumps uv.lock
    Given the sdks/python package in the release-please config
    Then it has exactly one toml extra-files entry for /uv.lock

  @unit
  Scenario: A lock behind the release version fails the check
    Given the langwatch entry in uv.lock differs from pyproject.toml or the release manifest
    Then the guard fails and tells the developer to run `uv lock`

  @unit
  Scenario: A lock in step passes
    Given the langwatch entry in uv.lock matches pyproject.toml and the release manifest
    Then the guard reports no problem

  @unit
  Scenario: A pyproject without a static project version fails the check
    Given sdks/python/pyproject.toml has no static version under [project]
    Then the guard says there is no static [project] version
