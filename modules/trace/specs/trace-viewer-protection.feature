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
