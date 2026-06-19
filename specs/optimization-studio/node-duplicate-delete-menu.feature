Feature: Duplicating and deleting a workflow node from its action menu

  A node on the optimization-studio canvas exposes a "..." action menu, both on
  the node itself and in the node drawer that opens on the right when the node
  is selected. The menu offers Duplicate and Delete so users have a discoverable
  way to manage a node without relying on keyboard shortcuts. Structural entry
  and end nodes cannot be duplicated or deleted, so they do not show the menu.

  # Bindings: langwatch/src/optimization_studio/components/drawers/__tests__/StudioDrawerWrapper.integration.test.tsx

  Background:
    Given a workflow open on the studio canvas

  @integration
  Scenario: The node drawer offers a duplicate action
    Given a component node is selected and its drawer is open
    When the user opens the node action menu in the drawer and chooses Duplicate
    Then a copy of the node is added to the workflow

  @integration
  Scenario: The node drawer offers a delete action
    Given a component node is selected and its drawer is open
    When the user opens the node action menu in the drawer and chooses Delete
    Then the node is removed from the workflow and the drawer closes

  @integration
  Scenario: Structural nodes do not expose the action menu
    Given the entry node is selected and its drawer is open
    Then the node action menu is not shown
