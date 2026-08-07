Feature: Configurable time spans are always a count of seconds

  Every time span an operator can configure is a plain count of seconds, on a
  variable whose name ends in _SECONDS: 300, never 5m. That holds across the
  gateway, nlpgo and langyagent, so a number read off one service's
  documentation means the same thing on the next.

  The guardrail exists because the alternative is undiagnosable. A service
  that accepted a duration-typed setting would read the same variable as an
  opaque nanosecond count, so 5m would be refused outright while 300 would
  quietly mean 300 nanoseconds, and which one an operator got would depend on
  something invisible from outside the process.

  So the refusal lands on the declaration rather than on the value: a service
  that introduces such a setting fails on its first boot, with an error naming
  the variable and the seconds convention, instead of on the first deployment
  that tries to configure it. Nothing in the repo declares one, and this keeps
  it that way.

  # Bindings: pkg/config/config_test.go

  @unit @regression
  Scenario: a service declaring a duration-typed time span fails to start
    Given a service declares an env-configurable time span as a duration
    And its variable is set to 5m
    When the service loads its configuration
    Then startup fails with an error naming that variable
    And the error names the duration type as the problem
    And the error points at the seconds convention

  @unit @regression
  Scenario: the refusal does not wait for anyone to set the variable
    Given a service declares an env-configurable time span as a duration
    And its variable is not set in the environment
    When the service loads its configuration
    Then startup still fails with an error naming that variable
    And the setting is left at its zero value

  @unit @regression
  Scenario: a nested time span is named by the variable an operator would set
    Given a service declares its auth-cache settings as a nested group
    And one of them is declared as a duration
    When the service loads its configuration
    Then startup fails naming LW_GATEWAY_AUTH_CACHE_CONFIG_TTL in full
    And not the bare name the group was declared under

  @unit @regression
  Scenario: a plain whole-number setting is unaffected
    Given a service declares a setting as a plain whole number
    When its variable is set to 300000000000
    Then the setting holds 300000000000
