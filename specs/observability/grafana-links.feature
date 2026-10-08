Feature: Grafana deep links from errors and ops screens
  As an engineer chasing a failure
  I want an error and an ops row to link straight into Grafana Explore
  So that I reach the failing trace or logs without copying ids by hand

  Grafana is configured by GRAFANA_BASE_URL, with GRAFANA_TEMPO_DATASOURCE_UID
  and GRAFANA_LOKI_DATASOURCE_UID overriding the LGTM bundle's datasource uids.

  Scenario: A configured Grafana gives a handled error a trace link
    Given GRAFANA_BASE_URL names a Grafana
    When a handled error with a trace id is serialised
    Then it carries a traceUrl opening that trace in Tempo

  Scenario: With no Grafana configured an error carries no link and nothing fails
    Given GRAFANA_BASE_URL is unset
    When a handled error with a trace id is serialised
    Then it carries no traceUrl

  Scenario: A malformed Grafana base URL yields no link rather than a second error
    Given GRAFANA_BASE_URL is a bare host with no scheme
    When a handled error with a trace id is serialised
    Then it carries no traceUrl and serialising does not throw

  Scenario: Ops screens are handed the link config only when a Grafana is configured
    Given the ops screens ask for the Grafana link config
    Then they receive the base URL and datasource uids when GRAFANA_BASE_URL is set
    And they receive nothing when it is unset, so no link is rendered

  Scenario: Every process role reads the Grafana settings from its observability config
    Given GRAFANA_BASE_URL and GRAFANA_TEMPO_DATASOURCE_UID name a Grafana
    When an api or worker process parses its configuration
    Then its observability settings carry the Grafana base URL and datasource uid
    And with GRAFANA_BASE_URL blank they carry no Grafana base URL
