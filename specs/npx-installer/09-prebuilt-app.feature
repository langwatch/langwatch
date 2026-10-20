Feature: `npx @langwatch/server` runs a prebuilt app
  As someone installing LangWatch on my own machine
  I want the first run to download a ready-built app
  So that my machine never installs build tooling or builds LangWatch itself

  See ../../dev/docs/adr/180-npx-server-downloads-a-prebuilt-app.md.

  # ===========================================================================
  # Publishing
  # ===========================================================================

  # Enforced by the app-archive matrix in .github/workflows/npx-server-publish.yml.
  @unimplemented
  Scenario Outline: Every release publishes a prebuilt app for each platform
    When a release "v<version>" is published
    Then the release has "langwatch-app-<slug>.tar.gz" and "langwatch-app-<slug>.tar.gz.sha256"
    And the archive was built on a "<slug>" runner

    Examples:
      | slug         |
      | linux-amd64  |
      | linux-arm64  |
      | darwin-amd64 |
      | darwin-arm64 |

  @unit
  Scenario: Publish refuses to ship npm without every app archive
    Given one platform's app archive failed to build
    When the publish job runs
    Then nothing is published to npm

  @unit
  Scenario: The app archive holds only what running it needs
    When the publish job builds an app archive
    Then it holds production dependencies, the built UI and the generated files
    And it holds no compilers, test runners, linters, tests or source maps
    And every link inside it resolves

  @unit
  Scenario: The image and the app archive are pruned by the same recipe
    Then the production image and the app archive run one shared prune script

  @unit
  Scenario: The npm package is the CLI only
    When the publish job packs the npm package
    Then it contains "dist/cli.cjs", "package.json", "README.md" and "LICENSE.md"
    And it contains no application source and no lockfile

  # ===========================================================================
  # First run
  # ===========================================================================

  @unit
  Scenario: First run downloads and verifies the app for this version
    Given a machine with no LangWatch install
    When they run "npx @langwatch/server"
    Then the app archive for this version and platform is downloaded
    And its checksum is verified before it is extracted
    And it lands in "~/.langwatch/app/<version>/"
    And no pnpm install and no build runs

  @unit
  Scenario: A checksum mismatch stops the install
    Given the downloaded app archive does not match its checksum
    When the app is installed
    Then the install fails naming the archive and the release
    And nothing is extracted into "~/.langwatch/app"

  @unit
  Scenario: An interrupted extract is not mistaken for an install
    Given an earlier run stopped while extracting the app
    When they run "npx @langwatch/server" again
    Then the app is downloaded and extracted again

  @unit
  Scenario: A second run reuses the installed app
    Given the app for this version is installed
    When they run "npx @langwatch/server" again
    Then nothing is downloaded

  # ===========================================================================
  # Upgrades
  # ===========================================================================

  @unit
  Scenario: A new version replaces the old app and keeps the data
    Given the app for version "3.20.1" is installed with data
    When they run "npx @langwatch/server@3.21.0"
    Then the app for "3.21.0" is installed
    And the app for "3.20.1" is removed
    And the data under "~/.langwatch/data" is unchanged

  @unit
  Scenario: Two first runs at once install the app once
    Given two "npx @langwatch/server" runs start at the same time on a machine without the app
    When both reach the app predep
    Then one downloads and extracts the app while the other waits for it
    And the other uses the app the first installed, without downloading it again

  @unit
  Scenario: A lock left by a run that ended does not hold up the next
    Given a run that was installing the app ended without releasing its lock
    When the next run reaches the app predep
    Then it takes the lock over and installs the app

  @unit
  Scenario: A new version keeps the app a running LangWatch serves
    Given a running LangWatch serves the app for "3.20.1"
    When another run installs "3.21.0"
    Then "app/3.20.1" stays in place
    And a version no running LangWatch serves is removed

  @unit
  Scenario: An install made by an older CLI is replaced
    Given "~/.langwatch/app" holds the source tree an older CLI installed
    When they run the new CLI
    Then that tree is replaced by the prebuilt app
    And the data under "~/.langwatch/data" is unchanged

  # ===========================================================================
  # Where it does not apply
  # ===========================================================================

  @unit
  Scenario: Run from a checkout, the CLI uses the checkout
    Given the CLI runs from a repository checkout
    When it starts
    Then it runs the checkout in place and downloads no app archive
    # The checkout needs its developer's own `pnpm install` and `pnpm run build:server`;
    # the CLI says so rather than installing or building anything itself.

  @unit
  Scenario: A locally built archive can stand in for the release
    Given "LANGWATCH_APP_ARCHIVE" names a locally built app archive
    When the app is installed
    Then that archive is installed instead of the release download

  @unit
  Scenario: Node older than 24 is refused with a clear message
    Given Node 22
    When they run "npx @langwatch/server"
    Then it exits before installing anything
    And the message says LangWatch needs Node 24 or newer

  @unit
  Scenario: Linux on musl is refused with a clear message
    Given an Alpine Linux machine
    When they run "npx @langwatch/server"
    Then it exits before installing anything
    And the message points at the Docker image instead

  # ===========================================================================
  # Starting
  # ===========================================================================

  @unit
  Scenario: The tokenizer files arrive with the app
    Given the prebuilt app was built with its tokenizer files for the app and for LangEvals
    When they run "npx @langwatch/server" for the first time
    Then the backend and LangEvals read the app's own tokenizer files
    And no tokenizer file is downloaded at first start

  @unit
  Scenario: The backend starts through pnpm
    When the CLI starts the backend
    Then it runs apps/backend's start script with pnpm, the bundled one when there is one
    And the bundled pnpm is on PATH for the app's own scripts that run it

  @unit
  Scenario: Starting twice reuses compiled modules
    When the CLI starts the backend
    Then Node's compile cache points under the LangWatch home

  @unit
  Scenario: The port check asks the system once
    Given another process listens on one of the ports
    When the CLI checks the ports before starting
    Then it asks the system for every listening port in one call
    And it names the process holding that port and suggests a free slot

  @unit
  Scenario: The stores start while the app is still arriving
    Given the Postgres, Redis and ClickHouse binaries are ready but the app is still downloading
    When the CLI starts
    Then Postgres, Redis and ClickHouse start at once
    And the Go services start as soon as their binary and the stores are ready
    And the backend starts only once the app and the stores are in place

  @unit
  Scenario: The backend does not wait for LangEvals
    Given LangEvals' Python environment is still being prepared
    When the stores and the app are ready
    Then the backend starts
    And LangEvals starts once its environment is ready, on its own

  @unit
  Scenario: Aborting the install stops the services already started
    Given the stores started while the other predeps were still installing
    When an install fails and they abort, or CI aborts for them, or they press Ctrl+C at the prompt
    Then every service already started is stopped
    And the CLI exits with 1 for an abort and 130 for Ctrl+C

  @unit
  Scenario: Skipping an optional predep starts LangWatch without what needs it
    Given the install of the assistant's runtime or of uv failed
    When they choose to skip it and continue
    Then the backend starts without the assistant, or without LangEvals
    And the terminal says which service stays off and why

  @unit
  Scenario: LangEvals failing its first boot still takes the stack down
    Given the backend is starting
    When LangEvals never becomes healthy
    Then every service that started is stopped and the CLI exits non-zero

  @unit
  Scenario: The browser opens on a boot page at once
    When they run "npx @langwatch/server"
    Then the public port answers within a second, before any service is up
    And a browser sees a "Starting LangWatch" page in the look of the api's own console
    And an API caller gets a plain 503 with a retry header

  @unit
  Scenario: The boot page shows each service's state
    When the services start one by one
    Then the boot page shows each one starting, ready, restarting or failed as it happens

  @unit
  Scenario: Ready means the backend is healthy, and the page reloads into the app
    When the backend answers its health route
    Then the public port forwards to the backend, keeping the browser's Host
    And the boot page reloads into the app

  @unit
  Scenario: The health check on the public port reports the backend once it is up
    Given the boot page answers "/healthz" while the backend starts
    When the public port switches to the backend
    Then "/healthz" is answered by the backend, so it fails when the backend does

  @unit
  Scenario: A failed first boot shows on the boot page with the log path
    When a service fails its first boot
    Then the boot page says what failed and where the logs are

  @unit
  Scenario: The app's assets load while the backend is still starting
    Given the app is unpacked and the backend is not healthy yet
    When the boot page is open
    Then the public port serves the app's hashed assets, cached for good
    And the boot page fetches the app's entry scripts and styles
    But the app's index page stays the api's, which adds each visitor's settings

  @unit
  Scenario: The boot page serves no file outside the app's assets
    Given the app is unpacked and the backend is not healthy yet
    When a request names a path that climbs out of "/assets", or one that cannot be read
    Then no file is served for it and the public port keeps answering
