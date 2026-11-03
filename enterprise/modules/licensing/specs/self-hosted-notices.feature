Feature: LangWatch staff send notices to self-hosted installs
  LangWatch Cloud admin staff write a notice in Ops on Cloud ("a new release
  is out", "a vulnerability is fixed in 3.4.2, upgrade now"). Every self-hosted
  install receives the published notices in Cloud's reply to its daily usage
  report, beside the latest release. Licensing owns the notices, enterprise-ops
  admits staff, and saas puts them in the reply.

  @integration
  Scenario: Cloud admin staff publish a notice from Ops
    Given a LangWatch Cloud admin opens Ops, Self-hosted notices
    When they write a notice with severity "security", a title, a body, a link and "fixed in 3.4.2"
    And they publish it
    Then the notice is listed as published with who published it and when
    And the publication is written to the audit log

  @unit
  Scenario: Only LangWatch Cloud admin staff manage notices
    Given a user who is not LangWatch Cloud admin staff, or a deployment that is not LangWatch Cloud
    When they list, create, publish, withdraw or edit a notice
    Then the call is refused by the door before any notice is read or written

  @unit
  Scenario: A notice is validated before it is kept
    Given a notice with an empty title, a title over 120 characters, a body over 2000 characters, a link that is not https, or a "fixed in" that is not a release name
    When staff create or edit it
    Then it is refused with a validation error naming the field

  @unit
  Scenario: A draft or withdrawn notice is never sent
    Given one draft notice, one withdrawn notice and one published notice
    When Cloud answers a usage report
    Then the reply carries only the published notice

  @unit
  Scenario: An expired notice is no longer sent
    Given a published notice whose expiry has passed
    When Cloud answers a usage report
    Then the reply carries no notices

  @unit
  Scenario: The usage report reply carries published notices beside the latest release
    Given one published notice with severity "security" fixed in 3.4.2
    When Cloud answers a usage report
    Then the reply names the latest release and a "notices" list with that notice's id, severity, title, body, link, fixed-in release and publication time

  @unit
  Scenario: A notice that cannot be read does not refuse the report
    Given reading the notices fails
    When Cloud answers a usage report
    Then the report is still accepted and the reply names the latest release with no notices
    And the failure is logged
