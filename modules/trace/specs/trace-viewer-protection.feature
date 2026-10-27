Feature: Trace viewer protections honour group audiences
  The trace drawer hides captured content from the same members an LWQL chart
  does: a content audience naming a group opens only to that group's members.

@unit
Scenario: Trace content restricted to a group is visible to a member of that group
  Given trace input on a project is restricted to the "security" group
  When a member of the "security" group opens a trace on that project
  Then the trace input is visible to them

@unit
Scenario: Trace content restricted to a group is hidden from a member outside it
  Given trace input on a project is restricted to the "security" group
  When a member of no such group opens a trace on that project
  Then the trace input is hidden from them and the output stays visible

@unit
Scenario: A failed group membership read hides group-restricted trace content
  Given trace input on a project is restricted to the "security" group
  And the viewer's group membership cannot be read
  When they open a trace on that project
  Then the trace input is hidden from them

  @unit
  Scenario: A project-bound access token reads trace costs as its person
    Given a person's project-bound access token, which has no key row
    When it reads a trace over REST
    Then cost visibility is asked of that person's user principal at the project

  # Moved from project.getFieldRedactionStatus: the door moves with the protections' owner
  # (peer-cycles plan 2026-10-08 T2b, R36; namespace moves with its owner, CD-2).
  @unit
  Scenario: The field redaction status answers from the reader's own protections
    Given trace input on a project is hidden from a reader and visible to "Admins"
    When the reader asks traces for the project's field redaction status
    Then the input reads as redacted and visible to "Admins", and the output reads as visible

  @unit
  Scenario: Free text matches captured content only for a viewer who may read it
    Given trace input on a project is hidden from a reader
    When the reader searches the trace list with a bare word
    Then the word is matched against trace and span names only, not captured input or output
    And a reader under no content protection still matches captured input and output

  @unit
  Scenario: An attribute filter on a value the viewer may not read matches nothing
    Given trace input on a project is hidden from a reader
    When the reader filters the trace list on a captured-input attribute
    Then no trace matches on that attribute's value
    And a filter on an attribute the reader may read still matches as before

  # Access to a project can come from a role on the organization, on the team, or on the
  # project itself. All three count as "a member of the project" for content visibility,
  # because membership is the permission engine's own answer to reading traces there.
  # Moved from specs/data-privacy/content-visibility.feature (superseded PR #8298).

  @unit
  Scenario: An organization admin with no team role sees captured content
    Given no privacy rule restricts content on "web-app"
    And "olga" is an organization admin with no role on the "platform" team
    When "olga" opens a trace for "web-app"
    Then the trace input is visible to "olga"

  @unit
  Scenario: An organization admin with no team role is in the Admins audience
    Given a rule on "web-app" that restricts trace input to admins
    And "olga" is an organization admin with no role on the "platform" team
    When "olga" opens a trace for "web-app"
    Then the trace input is visible to "olga"

  @unit
  Scenario: A project-level role counts as project membership
    Given no privacy rule restricts content on "web-app"
    And "pete" holds a member role on "web-app" only
    When "pete" opens a trace for "web-app"
    Then the trace input is visible to "pete"

  @unit
  Scenario: Belonging to the organization does not put a viewer in the Members audience
    Given a rule on "web-app" that restricts trace input to the Members role group
    And "vera" holds a viewer role on the "platform" team and is an ordinary member of "acme"
    When "vera" opens a trace for "web-app"
    Then the trace input is redacted for "vera"

  @unit
  Scenario: Someone the permission engine denies trace access is not a member
    Given no privacy rule restricts content on "web-app"
    And "xena" is an ordinary member of "acme" with no role that reaches "web-app"
    When "xena" opens a trace for "web-app"
    Then the trace input is redacted for "xena"

  # When the input or output is hidden, the attributes that carry it are replaced whole.
  # Other span attributes are not blanked just because they contain a short word ("user",
  # "text") or an empty string that also appears somewhere in the hidden content.

  @unit
  Scenario: Hidden input is replaced whole in the attributes that carry it
    Given "dave" cannot see the input of a span
    When "dave" opens that span's attributes
    Then "langwatch.input" is replaced by a redaction placeholder naming the audience
    And the placeholder keeps its audience even when the hidden input shares a word with it

  @unit
  Scenario: Hidden output is replaced whole in the attributes that carry it
    Given "dave" can see the input of a span but not its output
    When "dave" opens that span's attributes
    Then the gen_ai output messages are replaced by a redaction placeholder naming the audience
    And the gen_ai input messages are still visible to "dave"

  @unit
  Scenario: Hiding input does not blank unrelated attributes
    Given "dave" cannot see the input of a span whose messages have the role "user" and an empty text part
    When "dave" opens that span's attributes
    Then an unrelated attribute whose value contains "user" is still visible to "dave"

  @unit
  Scenario: Hidden input copied into another attribute is still scrubbed
    Given "dave" cannot see the input of a span
    And an unrelated attribute carries a copy of that input's message text
    When "dave" opens that span's attributes
    Then that attribute is redacted for "dave"

  @unit
  Scenario: Media references of hidden content stay dropped when attribute rules apply
    Given "dave" cannot see the input of a trace that carries media references
    And a custom attribute rule hides another attribute from "dave"
    When "dave" opens the trace
    Then the reserved input media-reference attribute is still absent
