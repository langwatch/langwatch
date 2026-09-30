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
