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

  @unit
  Scenario: Owner-only content stays hidden when a read spans a project the viewer does not own
    Given "alice" owns the aggregate project she reads from
    And a member project of that aggregate, owned by someone else, restricts trace input to its owner
    When "alice" reads traces or analytics across both projects
    Then the trace input is redacted for "alice"

  @unit
  Scenario: Admins-only content stays hidden when a read spans a project where the viewer is no admin
    Given "alice" is an Admin of the aggregate project she reads from
    And "alice" is only a Member of one of its member projects
    And trace input is restricted to admins
    When "alice" reads traces or analytics across both projects
    Then the trace input is redacted for "alice"

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

  # ADR-208: a rule's audience may name API keys, next to the role groups and
  # custom groups. A named key reads that rule's restricted content as Admins
  # do; every other key keeps reading restricted content as the public. The
  # key's own expiry and revocation end it; there is no second end date.
  Rule: A rule's audience may name API keys

    @unit
    Scenario: A key named in the audience sees restricted content
      Given a rule on "web-app" that restricts trace input to admins and the key "analysis-agent"
      When the key "analysis-agent" reads a trace for "web-app"
      Then it sees the input

    @unit
    Scenario: A key not named in the audience keeps reading restricted content as the public
      Given a rule on "web-app" that restricts trace input to admins and the key "analysis-agent"
      When the key "ci-pipeline" reads a trace for "web-app"
      Then the input is redacted

    @unit
    Scenario: A named key never sees more than Admins
      Given a rule on "web-app" that restricts trace input to the project owner and names the key "analysis-agent"
      When the key "analysis-agent" reads a trace for "web-app"
      Then the input is redacted, as it is for an admin
      And picking a key in the audience picker keeps Admins in the audience

    @unit
    Scenario: A named key never sees dropped content
      Given a rule on "web-app" that drops trace input and names the key "analysis-agent"
      When the key "analysis-agent" reads a trace for "web-app"
      Then the input is not there

    @unit
    Scenario: Rules that disagree keep only the keys every rule names
      Given a read across two projects whose rules name different keys
      When the strictest policy is resolved
      Then only a key both rules name sees the restricted content

    @unit
    Scenario: The audience picker lists the organization's keys by name
      Given an organization with a service key, a personal key, a revoked key and a key LangWatch minted for itself
      When an admin opens the restricted-content audience picker
      Then it offers the service key under "API keys" by the name its owner gave it
      And it explains that a picked key sees what Admins see
      And it never offers the personal key, the revoked key or the one LangWatch minted

    @unit
    Scenario: Saving a rule that names a key the organization does not have is refused
      Given a rule whose audience names a key from another organization, or one LangWatch minted for itself
      When the rule is saved
      Then it is refused with a validation error naming the audience

    # A personal key acts as its person and never reads more than they do, so only a
    # service key may be named.
    @unit
    Scenario: Saving a rule that names a personal key is refused
      Given a rule whose audience names a key that acts as one member
      When the rule is saved
      Then it is refused with a validation error naming the audience

    @unit
    Scenario: Saving a rule that names a key without Admins in the audience is refused
      Given a rule that restricts trace input to the "security" group and names the key "analysis-agent"
      When the rule is saved
      Then it is refused, since a named key reads only what Admins read

    @unit
    Scenario: Saving a rule whose restricted categories name different keys is refused
      Given a rule that restricts input naming the key "analysis-agent" and output naming no key
      When the rule is saved
      Then it is refused, since the drawer edits one audience for every restricted category

    @unit
    Scenario: Only an organization admin adds a key to a rule
      Given a project admin who is not an organization admin edits a rule that names the key "analysis-agent"
      When they save it naming the key "ci-pipeline" as well
      Then the save is refused
      And saving it with only "analysis-agent" still succeeds

    @unit
    Scenario: Saving a custom attribute rule that names a key is refused
      Given a custom attribute rule that restricts "app.billing.*" to admins and names the key "analysis-agent"
      When the rule is saved
      Then it is refused, since no key reads restricted attributes

    @unit
    Scenario: Saving a rule that adds a key asks first
      Given a rule on "web-app" that restricts trace input to admins
      When an admin picks the key "analysis-agent" and saves
      Then a dialog asks "Let an API key read restricted content?" and names the key
      And saving a rule that already named every key asks nothing

    @unit
    Scenario: The rules table counts the keys a rule names
      Given a rule that restricts input and output and names two keys
      Then its row in the rules table says "2 API keys read restricted content"

    @unit
    Scenario: The picker says when the API keys could not be loaded
      Given the organization's API keys cannot be read right now
      When an admin opens a rule that names the key "analysis-agent"
      Then the picker and the line under it call it a key whose name could not be loaded, never a key no longer live
      And with no key named the picker says the keys could not be loaded
