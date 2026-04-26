Feature: Supply chain dependency age gates

  Scenario: JavaScript dependency resolution waits before accepting new releases
    Given a maintainer installs or updates JavaScript dependencies with pnpm
    When pnpm resolves direct and transitive package versions
    Then package versions published less than 7 days ago are not selected

  Scenario: Python dependency resolution waits before accepting new releases
    Given a maintainer locks, syncs, or updates Python dependencies with uv
    When uv resolves direct and transitive package distributions
    Then package distributions uploaded less than 7 days ago are not selected
