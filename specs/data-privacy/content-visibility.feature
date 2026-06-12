Feature: Restricting who can see trace content
  As a team handling sensitive conversations
  I want stored trace content to be visible only to a chosen audience
  So that the data is kept for debugging but only the right people can read it

  # "Restrict" stores the content but hides it at read time from anyone outside
  # the audience. The audience is built on the forward access model: the
  # built-in role groups (Admins, All members, Viewers), the project owner for
  # personal projects, plus any of the organization's custom RBAC groups
  # (custom groups exist only on the enterprise plan, since only it can create
  # them). Departments scope WHERE a rule applies, never WHO can see content.
  # An empty audience means no one can see it. Unlike dropping, restricting is
  # fully retroactive - changing the audience changes who can read existing
  # traces immediately. A viewer outside the audience sees a redaction
  # placeholder with the reason, not a blank field.

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
  Scenario: An empty audience hides content from everyone including admins
    Given a rule on "web-app" that restricts trace input to no one
    When "carol" opens a trace for "web-app"
    Then the trace input is redacted for "carol"

  @integration
  Scenario: Content restricted to viewers is visible to a viewer-role holder
    Given a user "grace" with the viewer role on "platform"
    And a rule on "web-app" that restricts trace input to viewers
    When "grace" opens a trace for "web-app"
    Then the trace input is visible to "grace"
    When "dave" opens a trace for "web-app"
    Then the trace input is redacted for "dave"

  # Personal projects can be restricted to the person themselves: each member
  # sees the traces of their own workspace and nobody else's, with an optional
  # extra group (for example a super-admin group) that can see everything.

  @integration
  Scenario: Only the owner of a personal project sees its content
    Given a personal project "alice-workspace" owned by "alice"
    And a rule for all personal projects that restricts trace input to the project owner
    When "alice" opens a trace for "alice-workspace"
    Then the trace input is visible to "alice"
    When admin "carol" opens a trace for "alice-workspace"
    Then the trace input is redacted for "carol"

  @integration
  Scenario: The owner-only audience can be widened with a chosen group
    Given a personal project "alice-workspace" owned by "alice"
    And a rule for all personal projects that restricts trace input to the project owner and the "security" group
    When "erin" opens a trace for "alice-workspace"
    Then the trace input is visible to "erin"
    When "dave" opens a trace for "alice-workspace"
    Then the trace input is redacted for "dave"

  # Custom attribute rules restrict individual span attributes the same way:
  # the matching attribute values are replaced by a redaction placeholder for
  # viewers outside the audience, while the rest of the attributes stay visible.

  @integration
  Scenario: A restricted custom attribute is hidden from outside the audience
    Given a rule on "web-app" that restricts attributes matching "app.billing.*" to admins
    And a trace stored for "web-app" carrying an "app.billing.card_token" attribute
    When "dave" opens that trace's span attributes
    Then the "app.billing.card_token" value is replaced by a redaction placeholder naming the audience
    And the other span attributes remain visible to "dave"
    When "carol" opens that trace's span attributes
    Then the "app.billing.card_token" value is visible to "carol"

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
