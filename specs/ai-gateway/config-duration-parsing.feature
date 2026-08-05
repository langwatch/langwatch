Feature: Config time spans are seconds, and the hydrator enforces it

  Every service sharing pkg/config.Hydrate (aigateway, nlpgo, langyagent)
  expresses an env-configurable time span the same way: an int64 count of
  seconds, on a variable whose name ends in _SECONDS. Server.GracefulSeconds,
  Server.DrainDelaySeconds, NonStreamingHeartbeatIntervalSeconds and the
  auth-cache knobs all follow it.

  A time.Duration field would break that. time.Duration is a defined int64,
  so Hydrate routes it by reflect.Kind() into the generic integer branch,
  where the only value that sets it is an opaque raw nanosecond count. One
  config surface would then carry two incompatible notations for the same
  idea, and which one applies would depend on a field's Go type rather than
  on anything an operator can see.

  Hydrate therefore refuses an env-tagged time.Duration field outright,
  naming the seconds convention in the error. The refusal is on the
  declaration, not on a bad value, so it fires on the first boot of the
  service that introduced the field rather than on the first deployment that
  tries to configure it. The repo has no such field, and this keeps it that
  way.

  # Bindings: pkg/config/config_test.go

  @unit @regression
  Scenario: an env-tagged time.Duration field is refused
    Given a struct field of type time.Duration tagged env:"SOFT_BUMP"
    And SOFT_BUMP is set to 5m
    When the struct is hydrated
    Then Hydrate returns an error naming SOFT_BUMP
    And the error names time.Duration as the problem
    And the error points at the _SECONDS convention

  @unit @regression
  Scenario: an env-tagged time.Duration field is refused even when its variable is unset
    Given a struct field of type time.Duration tagged env:"HARD_GRACE_UNSET"
    And HARD_GRACE_UNSET is not set in the environment
    When the struct is hydrated
    Then Hydrate returns an error naming HARD_GRACE_UNSET
    And the field is left at its zero value

  @unit @regression
  Scenario: a time.Duration field nested in a sub-struct is refused with its full prefixed name
    Given a sub-struct tagged env:"LW_GATEWAY_AUTH_CACHE"
    And that sub-struct holds a time.Duration field tagged env:"CONFIG_TTL"
    When the outer struct is hydrated
    Then Hydrate returns an error naming LW_GATEWAY_AUTH_CACHE_CONFIG_TTL

  @unit @regression
  Scenario: a plain int64 field is unaffected by the time.Duration refusal
    Given a struct field of type int64 (not time.Duration) tagged env:"COUNT"
    When COUNT=300000000000 is hydrated onto it
    Then the field equals the integer 300000000000
