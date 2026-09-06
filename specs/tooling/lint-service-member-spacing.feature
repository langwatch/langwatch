Feature: The service-member-spacing lint rule
  Consecutive methods, constructors and accessors on a strict feature service
  class need one blank line between them. The rule fixes the gap it finds.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Adjacent methods without a blank line are reported and fixed
    Given a service class with two methods on adjacent lines
    When the service-member-spacing rule runs over it
    Then it reports memberSpacing

  @unit
  Scenario: Methods already separated by a blank line are left alone
    Given a service class with a blank line between its two methods
    When the service-member-spacing rule runs over it
    Then it reports nothing
