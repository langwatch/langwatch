Feature: LangWatchQL serves eventing's event tables from eventing's own declarations

  Eventing declares how each of its tables reads as a view; analytics composes those declarations
  into its catalogue and decides who may read them (Q205). The views a statement names, their
  columns and their gates are unchanged by the move.

  Rule: Every declared event table is a view, read only by a project manager

    @unit
    Scenario: Each declared event table is catalogued under its declared view name
      Given eventing's event-table declarations
      When analytics composes its LangWatchQL catalogue
      Then every declared view is in the catalogue, reading its declared source table

    @unit
    Scenario: An event-table view needs project management on top of analytics access
      Given eventing's event-table declarations
      When analytics composes its LangWatchQL catalogue
      Then every event-table view requires both analytics:view and project:manage

    @unit
    Scenario: A column eventing marks as secret or internal is exposed nowhere
      Given a declared column marked as secret or internal
      When analytics composes its LangWatchQL catalogue
      Then the column is omitted from the view

    @unit
    Scenario: A column eventing marks as captured output is gated by the data-privacy policy
      Given a declared column marked as captured output
      When analytics composes its LangWatchQL catalogue
      Then the column carries the output content gate

  Rule: Composing the declarations changes nothing a caller sees

    @unit
    Scenario: The event-table views publish the same definitions as before the move
      Given the event-table view definitions published before the move
      When analytics composes its LangWatchQL catalogue from the declarations
      Then each view's columns, join keys, description, grain and gates are unchanged
      And each view keeps its place in the published catalogue order
