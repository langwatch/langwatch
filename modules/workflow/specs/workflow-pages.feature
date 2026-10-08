# Implementation:
#   modules/workflow/browser/src/workflow.web.ts
#   packages/browser/src/ui-module-screens.ts
#   modules/workflow/browser/src/ui/sections/workflow-drag-preview.tsx

Feature: Workflow pages are guarded as they were on main
  The workflows list sat behind `withPermissionGuard("workflows:view")` on
  main. The screen declares that grant and the shell's router applies the
  page guard (dev/docs/ARCHITECTURE.md §10).

  @unit
  Scenario: The workflows list is guarded by workflows:view
    Given a browser that installs workflow
    When the router opens the workflows list
    Then the screen requires workflows:view before it renders

  @integration
  Scenario: The Studio canvas opens while nothing is being dragged
    Given a workflow opened in the Studio
    When the canvas renders before any palette node is picked up
    Then the drag preview renders nothing
    And the Studio does not fall back to the error screen

  @integration
  Scenario: The archive dialog names the evaluators the workflow backs
    Given a workflow two evaluators reference, one of them another workflow's
    When the reader opens the delete dialog
    Then it names the workflow's own evaluator and its monitor before the confirmation
    And it reads the evaluators by workflow rather than every evaluator in the project
