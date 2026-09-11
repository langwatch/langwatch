@unit
Feature: haven install checks the machine's prerequisites
  `make haven install` used to do two things: go install the binary and offer
  to put the Go bin dir on PATH. It said nothing about whether the machine had
  the tools haven then drives — portless, a Node toolchain, the brew formulae
  behind the managed Postgres and Redis, a container runtime. Every one of
  those was discovered later, as a failed `haven up`, one at a time.

  `haven install` is that check: it probes each prerequisite, shows what is
  missing, and offers to install it. Nothing is installed without being
  chosen, and anything declined with "never" is remembered machine-wide so the
  same question is not asked on every checkout.

  # Behaviour lives in tools/thuishaven: domain/prereq.go (the catalogue and
  # the planning), app/install.go (probing, ordering, persistence),
  # adapters/prereqs (the real probes and installers), adapters/installtui
  # (the picker), cmd/install.go (the command).

  Rule: Requirement level decides what a silent run does

    Scenario: A required prerequisite that is missing fails the check
      Given portless is not installed
      When the developer runs "haven install --list"
      Then portless is reported missing and marked required
      And the report names the command that would install it

    Scenario: An optional prerequisite that is missing is reported, not demanded
      Given the ClickHouse client is not installed
      And every required prerequisite is present
      When the developer runs "haven install --list"
      Then the ClickHouse client is reported missing and marked optional
      And the machine is still reported ready

    Scenario: Everything present reports ready and installs nothing
      Given every prerequisite is present
      When the developer runs "haven install"
      Then it reports the machine is ready
      And no installer is run

  Rule: A choice is offered once, not as two separate demands

    Scenario: Either container runtime satisfies the group
      Given colima and the docker CLI are installed
      When the prerequisites are planned
      Then the container runtime is satisfied
      And Docker Desktop is not also offered

    Scenario: A missing runtime offers the alternatives as one pick
      Given neither colima nor Docker Desktop is installed
      When the prerequisites are planned
      Then one container-runtime entry is offered
      And it carries both candidates so the developer picks one

  Rule: Order follows dependency, so an install never runs before its installer

    Scenario: Homebrew installs before anything it installs
      Given brew, redis and postgres are all missing
      When the chosen prerequisites are ordered
      Then brew comes before redis and postgres

    Scenario: Node installs before the npm globals
      Given node and portless are both missing
      When the chosen prerequisites are ordered
      Then node comes before portless

  Rule: "Never ask again" is remembered for the machine, not the checkout

    Scenario: Declining with never is persisted
      Given the ClickHouse client is missing
      When the developer answers "never ask again" for it
      Then it is recorded as skipped for this machine
      And a later run reports it as skipped instead of offering it

    Scenario: A skipped prerequisite is still installed when named
      Given the ClickHouse client is recorded as skipped
      When the developer runs "haven install clickhouse-client"
      Then it is installed
      And it is no longer recorded as skipped

    Scenario: The skips can be cleared
      Given two prerequisites are recorded as skipped
      When the developer runs "haven install --reset-skips"
      Then nothing is recorded as skipped any more
      And the next run offers both again

  Rule: Reporting never installs, and installing always reports

    Scenario: The report-only flag refuses to be given something to install
      Given the ClickHouse client is missing
      When the developer runs "haven install --list clickhouse-client"
      Then it fails saying the two cannot be combined
      And nothing is installed

    Scenario: A machine with nothing to do still says so
      Given every prerequisite is present
      And the developer is at a terminal
      When the developer runs "haven install"
      Then the full report is printed with the ready verdict
      And no picker is shown

    Scenario: A prerequisite present at the wrong version is not called missing
      Given portless is installed at a version haven does not pin
      When the prerequisites are planned
      Then the verdict says the machine is ready
      And it notes that portless is not the pinned version

  Rule: A prerequisite is probed the way haven will use it

    Scenario: A brew-managed server is judged by the formula, not the binary
      Given redis-server is on PATH but no redis formula is installed
      When the prerequisites are planned
      Then Redis is reported missing
      # haven starts it with `brew services`, which has nothing to start

    Scenario: A keg-only formula counts even with no binary on PATH
      Given postgresql@15 is installed but psql is not on PATH
      When the prerequisites are planned
      Then PostgreSQL is reported installed

  Rule: Only commands that can run on this platform are offered

    Scenario: A brew command is not offered where there is no brew
      Given the machine is not macOS
      And node is missing
      When the prerequisites are planned
      Then node is reported with words, not a `brew install` command
      And a silent run does not attempt it

  Rule: An agent and a pipe are never asked a question

    Scenario: Agent mode reports instead of prompting
      Given haven is running in agent mode
      And prerequisites are missing
      When the developer runs "haven install"
      Then the missing prerequisites are printed with the commands that fix them
      And no picker is shown and nothing is installed

    Scenario: A non-interactive run with --yes installs what is needed
      Given stdin is a pipe
      And node and portless are missing
      When the developer runs "haven install --yes"
      Then node and portless are installed
      And optional prerequisites are left alone

    Scenario: A prerequisite haven cannot install itself is explained, not attempted
      Given brew is missing
      When the developer runs "haven install --yes"
      Then brew is reported as install-it-yourself with its official command
      And no installer is run for it
      And the run stops there rather than failing on the formulae below it

  Rule: The picker asks the question and nothing else

    Scenario: The picker lists what needs deciding, not the whole inventory
      Given seven prerequisites are installed and two are missing
      When the picker opens
      Then it lists the two that are missing
      And it names the seven on one line underneath
      # Nine rows to ask one question buries the question in the answers.

    Scenario: Every column lines up, including the highlighted row
      Given the cursor is on a row
      When the list is rendered
      Then that row's columns start where every other row's columns start

  Rule: The picker chooses; the installing happens after it closes

    Scenario: Installs run with the terminal to themselves
      Given a terminal and missing prerequisites
      When the developer ticks two of them and confirms
      Then the picker closes first
      And each install runs in order with its own output visible

    Scenario: Quitting the picker installs nothing
      Given a terminal and missing prerequisites
      When the developer quits the picker
      Then nothing is installed and nothing is recorded as skipped

    Scenario: One failed install does not silently skip the rest
      Given three prerequisites were chosen
      When the second one fails to install
      Then the failure is reported naming the prerequisite
      And the run stops rather than reporting a success it did not get
