Feature: Predep detection and installation
  As a developer running npx @langwatch/server
  I want predeps installed automatically with my consent
  So that I do not have to read separate install pages for uv, redis, and clickhouse

  Background:
    Given I am at the predeps phase of "npx @langwatch/server"

  Scenario: All predeps already installed — phase auto-skips
    Given uv, postgres, redis-server, and clickhouse are on PATH or under "~/.langwatch/bin"
    When the predeps phase runs
    Then I see each predep marked "already installed" with the resolved version
    And no installer scripts are executed

  Scenario: Multi-select prompt offers all predeps pre-checked and all required
    Given at least one predep is missing
    When the predeps phase runs
    Then I see a multi-select prompt listing uv, postgres, redis, clickhouse
    And every option is checked by default
    And every option is marked "[required]"
    And attempting to uncheck a required option is rejected with a hint

  Scenario: Confirming installs missing predeps in parallel into "~/.langwatch/bin"
    Given uv, postgres, redis-server, and clickhouse are all missing
    When I confirm the multi-select prompt
    Then four subtasks run concurrently in a docker-pull-style table
    And uv is installed via "curl -LsSf https://astral.sh/uv/install.sh | sh" into "~/.langwatch/bin/uv"
    And postgres is downloaded from the EnterpriseDB binaries into "~/.langwatch/bin/postgres/"
    And redis-server is downloaded as a binary into "~/.langwatch/bin/redis-server"
    And clickhouse is downloaded via "curl https://clickhouse.com/" into "~/.langwatch/bin/clickhouse"
    And every line of installer stdout is shown beneath its row
    And on completion every row shows a green checkmark and the resolved version

  Scenario: Installer failure surfaces error and offers retry
    Given the network is unavailable
    When I confirm the multi-select prompt
    Then the affected row turns red with the failure reason
    And I am prompted to retry, skip, or abort
    And aborting exits with status 1 without touching other phases

  Scenario: Installed binaries are placed under "~/.langwatch/bin" and prepended to PATH for the session
    When the predeps phase finishes
    Then "~/.langwatch/bin" exists
    And "~/.langwatch/bin/redis-server", "~/.langwatch/bin/clickhouse" are executable
    And the runner phase has "~/.langwatch/bin" prepended to PATH
    And the user's shell is not modified — no .zshrc/.bashrc edits

  Scenario: AI Gateway monobinary is downloaded for the host platform
    Given I am on darwin/arm64
    When the predeps phase runs
    Then the gateway binary at "~/.langwatch/bin/aigateway" matches the host platform
    And the binary is verified against a SHA256 checksum from the GitHub release
    And tampering with the binary causes the next run to re-download

  Scenario: Predeps phase is idempotent — partial install is resumable
    Given uv installed successfully but clickhouse failed mid-download
    When I rerun "npx @langwatch/server"
    Then uv is reported as already installed
    And clickhouse resumes from a clean state, not from the partial file

  Scenario: Predeps install does not require sudo or shell rc edits
    When the predeps phase runs
    Then no command in the installer chain invokes sudo
    And no file under "$HOME" is modified except inside "~/.langwatch"
