Feature: Restricting who can see trace content
  As a team handling sensitive conversations
  I want stored trace content to be visible only to a chosen audience
  So that the data is kept for debugging but only the right people can read it

  # "Restrict" stores the content but hides it at read time from anyone outside
  # the audience. The audience is built on the forward access model: the two
  # built-in groups Admins and All members, plus any of the organization's
  # groups and departments. An empty audience means no one can see it. Unlike
  # dropping, restricting is fully retroactive - changing the audience changes
  # who can read existing traces immediately. A viewer outside the audience sees
  # a redaction placeholder with the reason, not a blank field.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"
    And an admin "carol", a plain member "dave", and a "security" group whose member is "erin"

  @integration
  Scenario: Content restricted to admins is hidden from a plain member
    Given a rule on "web-app" that restricts trace input to admins
    When "dave" opens a trace for "web-app"
    Then the trace input is redacted for "dave"

  @integration
  Scenario: Content restricted to admins is visible to an admin
    Given a rule on "web-app" that restricts trace input to admins
    When "carol" opens a trace for "web-app"
    Then the trace input is visible to "carol"

  @integration
  Scenario: Content restricted to a group is visible to members of that group
    Given a rule on "web-app" that restricts trace input to the "security" group
    When "erin" opens a trace for "web-app"
    Then the trace input is visible to "erin"
    When "dave" opens a trace for "web-app"
    Then the trace input is redacted for "dave"

  @integration
  Scenario: Content restricted to a department is visible to members of that department
    Given a member "frank" who belongs to the "hr" department
    And a rule on "web-app" that restricts trace output to the "hr" department
    When "frank" opens a trace for "web-app"
    Then the trace output is visible to "frank"

  @integration
  Scenario: An empty audience hides content from everyone including admins
    Given a rule on "web-app" that restricts trace input to no one
    When "carol" opens a trace for "web-app"
    Then the trace input is redacted for "carol"

  @integration
  Scenario: Restriction is retroactive
    Given a trace already stored for "web-app" with visible input
    When a rule that restricts trace input to admins is added for "web-app"
    Then "dave" can no longer see the input of the already-stored trace

  @integration
  Scenario: The redaction placeholder explains why content is hidden
    Given a rule on "web-app" that restricts trace input to admins
    When "dave" opens a trace for "web-app"
    Then the redacted input shows that it is hidden by a privacy policy
    And it names the audience that can see it

  @integration
  Scenario: Restricting content does not hide its metadata
    Given a rule on "web-app" that restricts trace input to admins
    When "dave" opens a trace for "web-app"
    Then "dave" still sees the trace's token counts, cost, and latency
