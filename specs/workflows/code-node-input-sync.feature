Feature: Code node inputs stay in sync with the Python signature
  As a user wiring a code node in the workflow studio
  I want every input I add by dragging to appear in the code entrypoint
  So that running the node does not fail with a keyword-argument error

  # Customer context: dragging an If/Else branch onto a code node's gate, or
  # wiring an output into a new input handle, added the input to the node but
  # left the `def __call__` signature untouched. The engine then called the
  # entrypoint with a keyword it did not accept ("unexpected keyword argument
  # 'gate'"). Adding inputs through the drawer's "+ Add" already synced the
  # signature; the drag paths now do the same. Separately, an unconnected
  # input is omitted from the call, so every parameter defaults to None to
  # avoid "missing a required argument".

  @unit
  Scenario: Dropping an If/Else branch on a code node adds the gate to the signature
    Given a code node with a single "input" parameter
    When an If/Else branch is dropped on the code node gate
    Then the code entrypoint signature includes the gate parameter

  @unit
  Scenario: Wiring a new input handle adds it to the signature
    Given a code node with a single "input" parameter
    When an output is wired into a new input handle on the code node
    Then the code entrypoint signature includes the new parameter

  @unit
  Scenario: Code inputs default to None
    Given a code node entrypoint
    When the inputs are written into the signature
    Then every parameter defaults to None so unconnected inputs do not error
