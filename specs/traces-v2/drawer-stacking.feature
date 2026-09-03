# Drawer back stack - Gherkin Spec
# Implementation:
#   packages/ui-drawer/src/behavior/use-drawer.ts
#   [gone] src/components/AddDatasetRecordDrawer.tsx
#   packages/features/trace/web/src/ui/sections/explorer/trace-drawer/use-trace-drawer-scaffold.ts
#
# Drawers open on top of each other: a trace hands over to "Add to Dataset", a
# simulation run hands over to a trace. Closing the drawer on top has to put the
# reader back where they came from, and closing the last one has to leave the
# page clear. The two failures this spec pins down are the reader losing the
# trace they were reading because a child drawer closed everything, and a drawer
# they had already left coming back on its own later in the session.

Feature: Moving between drawers without losing your place
  As a reader working through a trace
  I want a drawer opened from another one to hand me back when I close it
  So that a side trip never costs me the thing I was reading

  Background:
    Given I am logged into a project

  Rule: Closing a drawer hands me back to the one it was opened from

    @integration
    Scenario: Closing Add to Dataset opened from a trace returns me to that trace
      Given I am reading a trace in the trace drawer
      And I chose "Add to Dataset" from that trace
      When I close the "Add to Dataset" drawer
      Then I am back on that trace's drawer

    @integration
    Scenario: Adding the records hands me back to the trace as well
      Given I am reading a trace in the trace drawer
      And I chose "Add to Dataset" from that trace
      When the records are added to the dataset
      Then I am back on that trace's drawer

    @integration
    Scenario: Closing Add to Dataset opened from the traces list closes it outright
      Given I selected traces in the list without opening any of them
      And I chose "Add to Dataset" for the selection
      When I close the "Add to Dataset" drawer
      Then no drawer is left open

    @integration
    Scenario: Closing a trace opened from another drawer returns me to that drawer
      Given I opened a trace from a simulation run's drawer
      When I close the trace's drawer
      Then I am back on the simulation run's drawer

    @integration
    Scenario: A drawer I arrived on by link is where closing takes me back to
      Given I arrived on a page with a drawer already open from a link
      And I opened a second drawer from it
      When I close the second drawer
      Then I am back on the drawer the link opened

  Rule: A drawer I have left never comes back on its own

    @integration
    Scenario: Closing the trace drawer never reopens a drawer I already dismissed
      Given I dismissed a drawer earlier in the session
      And I am reading a trace I opened from the list
      When I close the trace's drawer
      Then no drawer is left open

    @integration
    Scenario: Opening a trace over Add to Dataset leaves nothing behind it
      Given I am reading a trace in the trace drawer
      And I chose "Add to Dataset" from that trace
      When I open another trace from the list behind the drawer
      And I close that trace's drawer
      Then no drawer is left open
