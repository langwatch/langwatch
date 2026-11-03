Feature: The terminal stays quiet unless something is wrong
  As someone running `npx @langwatch/server`
  I want a short, tidy terminal
  So that I see what is happening and what went wrong, not every service's log

  # Services log at warn by default into ~/.langwatch/logs/<service>.log. The terminal shows
  # progress, status and errors only. `--verbose` or LOG_LEVEL shows and keeps more. Each service
  # gets the level in the form it reads; one with no knob still writes only to its file.

  @unit
  Scenario: Services log at warn by default
    Given no LOG_LEVEL is set and "--verbose" is not passed
    When LangWatch starts
    Then every service is started at log level warn
    And each service's output goes to its own file in "~/.langwatch/logs"

  @unit
  Scenario: The terminal shows progress and status, not service output
    Given a start with the default log level
    Then the terminal shows each service starting and becoming healthy, and where the app is running
    And it shows no line of any service's own output

  @unit
  Scenario: An error from the backend shows as one readable line
    Given the backend logs an error after it is healthy
    Then the terminal shows one line naming the service and the error's message
    And not the raw JSON record

  @unit
  Scenario: A crash shows the end of that service's log
    When a service crashes
    Then the terminal shows the crash, the last 20 lines of that service's log and the log file's path

  @unit
  Scenario: Install output shows as progress only
    Given a first start that installs the app and the Python environment
    Then the terminal shows each step starting and finishing
    And not the package lists the installers print, which go to that step's log file

  @unit
  Scenario: Verbose shows everything
    When they run "npx @langwatch/server --verbose"
    Then every service runs at log level info
    And every service's output is shown in the terminal, prefixed with its name

  @unit
  Scenario: LOG_LEVEL sets the level for every service
    When they run it with "LOG_LEVEL=debug"
    Then every service runs at log level debug
    And the terminal shows every service's output

  @unit
  Scenario: The running line says where the logs are
    When the app is ready
    Then the terminal says where it is running, where the logs are, and how to stop it
