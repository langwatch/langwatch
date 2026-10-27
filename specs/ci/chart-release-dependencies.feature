Feature: The umbrella chart builds its dependencies after any subchart version bump
  As a release manager
  I want the langwatch chart to resolve its subcharts from the checkout it is built from
  So that a release that bumps a subchart version publishes without a manual lock fix

  # charts/langwatch depends on clickhouse-serverless, langwatch-gateway and
  # langwatch-langyagent through file:// repositories, and on prometheus at an
  # exact version. A committed Chart.lock pinned the file:// subcharts at their
  # previous versions, so every release that bumped them broke
  # `helm dependency build` until a separate job rewrote the lock on the
  # release PR. When the release PR merged before that job ran, the chart
  # release failed. With no committed lock, `helm dependency build` resolves
  # the same versions `helm dependency update` would, and there is nothing to
  # keep in sync.

  @unit
  Scenario: The umbrella chart has no committed Chart.lock
    Given the langwatch chart in the repository
    Then charts/langwatch/Chart.lock is not tracked by git

  @unit
  Scenario: Dependencies build after a release bumps every file subchart version
    Given a copy of the charts where every file:// subchart has a new version
    When helm dependency build runs on the umbrella chart
    Then it succeeds
    And it packages each file:// subchart at its new version
