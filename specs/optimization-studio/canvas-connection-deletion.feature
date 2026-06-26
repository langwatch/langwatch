Feature: Removing nodes and connections from the workflow canvas

  On the optimization-studio canvas a user edits a workflow by adding and
  removing nodes and the connections (edges) between them. A selected node or
  connection must be removable with either the Backspace or the Delete key, so
  the gesture works on macOS (Backspace) and on Windows and Linux keyboards
  (Delete) alike.

  Background:
    Given a workflow open on the studio canvas with two connected nodes

  @unit
  Scenario: Removing a selected connection with the Delete key
    Given the user has selected the connection between the two nodes
    When the user presses the Delete key
    Then the connection is removed from the canvas

  @unit
  Scenario: Removing a selected connection with the Backspace key
    Given the user has selected the connection between the two nodes
    When the user presses the Backspace key
    Then the connection is removed from the canvas

  @unit
  Scenario: Removing a selected node with the Delete key
    Given the user has selected a node
    When the user presses the Delete key
    Then the node is removed from the canvas
