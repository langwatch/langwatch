Feature: Restricting who can see trace content
  As a team handling sensitive conversations
  I want stored trace content to be visible only to a chosen audience
  So that the data is kept for debugging but only the right people can read it

  # "Restrict" stores the content but hides it at read time from anyone outside
  # the audience. The audience is a multi-selectable set of groups, picked with
  # the same chip picker as scopes: the standard role groups (Admins, Members,
  # Viewers), the organization's custom RBAC groups (enterprise is the only
  # plan that can create them), and "Project owners" for personal projects.
  # Any combination is allowed (for example project owners plus a super-admin
  # group). "All members" is the one exclusive choice: it means everyone with
  # project access, so picking it replaces any narrower selection. Departments
  # scope WHERE a rule applies, never WHO can see content. An empty audience
  # means no one can see it. Unlike dropping, restricting is fully retroactive
  # - changing the audience changes who can read existing traces immediately.
  # A viewer outside the audience sees a redaction placeholder with the
  # reason, not a blank field.

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

  @unit
  Scenario: Content restricted to the Members role group excludes admins and viewers
    Given a rule on "web-app" that restricts trace input to the Members role group
    Then a holder of the member role sees the trace input
    And an admin without the member role does not
    And a viewer does not

  @unit
  Scenario: Picking All members replaces any narrower audience selection
    Given an audience selection of the Admins role group and the "security" group
    When "All members" is picked
    Then the selection becomes "All members" alone
    And picking any group afterwards drops "All members" from the selection

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

  # System instructions and tool calls are restricted exactly like input and
  # output. They ride inside the captured conversation as system-role turns,
  # tool-role turns, and tool calls on assistant turns, so restricting one hides
  # only those turns from viewers outside the audience while the rest of the
  # conversation stays readable. The treatment is generic: every content category
  # (input, output, system instructions, tool calls) is hidden, shown, or marked
  # the same way, so a viewer never has to learn a different convention per field.

  @integration
  Scenario: System instructions restricted to admins are hidden from a plain member
    Given a rule on "web-app" that restricts system instructions to admins
    When "dave" opens a trace for "web-app"
    Then the system instructions are redacted for "dave"
    And the rest of the conversation remains visible to "dave"

  @integration
  Scenario: System instructions restricted to admins are visible to an admin
    Given a rule on "web-app" that restricts system instructions to admins
    When "carol" opens a trace for "web-app"
    Then the system instructions are visible to "carol"

  @integration
  Scenario: Tool calls restricted to a group are visible to that group and hidden from others
    Given a rule on "web-app" that restricts tool calls to the "security" group
    When "erin" opens a trace for "web-app"
    Then the tool calls are visible to "erin"
    When "dave" opens a trace for "web-app"
    Then the tool calls are redacted for "dave"
    And the user and assistant messages remain visible to "dave"

  # When content is restricted but the viewer IS in the audience, the view says
  # so instead of showing the content as if it were ordinary: a marker names the
  # audience the content is limited to, so an admin reading admin-only content
  # knows it is restricted rather than assuming everyone can see it. This applies
  # to every category the same way.

  @integration
  Scenario: A viewer inside the audience is told the content is restricted to them
    Given a rule on "web-app" that restricts trace input to admins
    When "carol" opens a trace for "web-app"
    Then the trace input is visible to "carol"
    And it is marked as restricted to the admins audience

  # Dropped content is marked per category as well, so the absence of a category
  # never reads as missing instrumentation: a dropped category shows that it was
  # removed by a privacy policy and cannot be recovered, distinct from a
  # restricted category, which is stored and only hidden.

  @integration
  Scenario: Each dropped category is marked where its content would appear
    Given a rule on "web-app" that drops system instructions
    And a trace stored for "web-app" from after the rule was added
    When "dave" opens that trace
    Then the system instructions show that they were dropped by a privacy policy
    And the marker distinguishes dropping from restriction

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
