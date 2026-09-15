Feature: One platform health answer for an external monitor

  Better Stack and every other external monitor asks one question: is the
  platform working right now. The `/api/v1/platform-health` family answers it
  by running the subsystem probes this deployment already has and reporting
  what each one said.

  The family is gated by a static key the deployment configures, not by a
  project API key: a monitor is not a tenant, and the answer it reads carries
  no tenant data. A deployment that configured no key serves no routes at all,
  so nobody reaches a platform-wide probe by presenting nothing.

  @integration
  Scenario: A request with no key runs no probe
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health without a key
    Then the answer is refused as unauthorized
    And no subsystem was probed

  @integration
  Scenario: A request with the wrong key runs no probe
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health with a key that is not this deployment's
    Then the answer is refused as unauthorized
    And no subsystem was probed

  @unit
  Scenario: A key of a different length is refused without a byte-by-byte comparison
    When a key of a different length to the configured one is presented
    Then it is refused
    And the comparison that did happen was constant time

  @integration
  Scenario: Each subsystem is reachable on its own path
    Given a deployment that configured a platform health key
    When a monitor asks for one named subsystem
    Then only that subsystem is probed
    And the answer names it

  @integration
  Scenario: A subsystem this platform does not have is not found
    Given a deployment that configured a platform health key
    When a monitor asks for a subsystem name this platform does not have
    Then the answer says there is no such subsystem

  @integration
  Scenario: The aggregate runs every subsystem
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health
    Then every subsystem is probed
    And the answer carries one entry per subsystem with how long it took

  @integration
  Scenario: A working platform answers success
    Given every subsystem answers
    When a monitor asks for the platform health
    Then the answer is a success
    And the overall status is healthy

  @integration
  Scenario: One broken subsystem makes the whole answer a failure
    Given one subsystem does not answer
    When a monitor asks for the platform health
    Then the answer is a service failure
    And the overall status is unhealthy

  @unit
  Scenario: A probe that throws is unhealthy and does not take the others down
    Given one subsystem probe throws
    When the platform health is checked
    Then that subsystem is reported unhealthy
    And every other subsystem is still reported

  @unit
  Scenario: A failure detail never carries the upstream's own words
    Given a subsystem refuses the probe with a message of its own
    When the platform health is checked
    Then the reported detail is our own words for what broke
    And it carries no upstream prose

  @unit
  Scenario: A subsystem this deployment never pointed anywhere is degraded, not broken
    Given a subsystem the deployment named no target for
    When the platform health is checked
    Then that subsystem is reported as not configured
    And the overall status is degraded rather than unhealthy

  @unit
  Scenario: A blank key is refused rather than read as unconfigured
    Given a deployment that exported the platform health key with no value
    When its configuration is validated
    Then the deployment is refused

  @integration
  Scenario: A deployment with no key serves no platform health routes
    Given a deployment that configured no platform health key
    When a monitor asks for the platform health
    Then there is no such route
