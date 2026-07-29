Feature: Config duration fields parse the format they're documented in

  pkg/config.Hydrate routes every env var onto a struct field by
  reflect.Kind(). time.Duration is a defined int64, so without an explicit
  check it fell into the generic integer branch and parsed via
  strconv.ParseInt — meaning a documented value like "5m" failed to parse,
  and the only value that actually worked was an opaque, undocumented
  nanosecond count.

  AuthCacheConfig.SoftBump/HardGrace/ConfigTTL (services/aigateway/config.go)
  were the fields this affected in practice, but per reviewer feedback
  (github.com/langwatch/langwatch/pull/5977#discussion — a defined-int64
  time.Duration field with string parsing reads as non-standard next to this
  same PR's plain-int Server.GracefulSeconds/DrainDelaySeconds) they were
  converted to plain int64 seconds instead of fixed in place — see
  gateway-service.feature's AuthCache scenario. This Hydrate-level fix
  remains: it is now preventative for the next time.Duration-tagged field
  added anywhere pkg/config.Hydrate is used (aigateway, nlpgo, langyagent all
  share it), demonstrated below with synthetic struct fields rather than a
  currently-affected real one.

  # Bindings: pkg/config/config_test.go, services/aigateway/config_test.go

  @unit @regression
  Scenario: a documented duration string like 5m parses correctly
    Given a struct field of type time.Duration tagged env:"SOFT_BUMP"
    When SOFT_BUMP=5m is hydrated onto it
    Then the field equals 5 minutes

  @unit @regression
  Scenario: a negative duration string parses correctly, matching the negative-disables convention
    Given a struct field of type time.Duration tagged env:"HARD_GRACE"
    When HARD_GRACE=-1s is hydrated onto it
    Then the field equals -1 second

  @unit @regression
  Scenario: a raw nanosecond integer no longer parses as a duration
    Given a struct field of type time.Duration tagged env:"CONFIG_TTL"
    When CONFIG_TTL=300000000000 is hydrated onto it
    Then Hydrate returns an error naming CONFIG_TTL
    # This is intentionally the value that used to be the only thing that
    # worked. Asserting it now fails is the regression test for the bug.

  @unit @regression
  Scenario: a plain int64 field is unaffected by the duration special-case
    Given a struct field of type int64 (not time.Duration) tagged env:"COUNT"
    When COUNT=300000000000 is hydrated onto it
    Then the field equals the integer 300000000000
