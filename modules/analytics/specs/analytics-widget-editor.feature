Feature: The dashboard widget editor knows the runtime its code runs in

  Widget code is React and TSX run in the sandboxed frame against the `LW` global, a few built-in
  modules and the query results. The editor's TypeScript worker is given typings for exactly that
  surface, so an editor error means a real mistake and completion offers real members.

  Rule: Code the frame runs is not flagged

    @integration
    Scenario: A widget that runs in the frame shows no editor errors
      Given a widget that uses React hooks, the charts library and the LW global
      When the editor's TypeScript worker checks it
      Then it reports no diagnostics

    @integration
    Scenario: A type error in widget code is reported
      Given a widget that misuses a React hook result or an unknown LW member
      When the editor's TypeScript worker checks it
      Then it reports a diagnostic naming the mistake

  Rule: Every name the frame provides is declared

    @unit
    Scenario: Every name the frame provides is declared for the editor
      Given the frame's shim, built-in modules, UMD globals and charts library
      When the editor's declarations are compared with what the frame provides
      Then a member the frame provides without a declaration fails the comparison

  Rule: Query rows are typed from the last run

    @unit
    Scenario: ClickHouse column types map to the TypeScript type a row carries
      Given a query column of a ClickHouse type
      When its row type is generated
      Then nullable, array and map wrappers and wide integers map to a matching TypeScript type

    @integration
    Scenario: Query result rows are typed from the last run's columns
      Given a query whose last run returned named, typed columns
      When the widget reads a row from that query
      Then each column completes and type-checks as its type

    @integration
    Scenario: A query that has not run yields unknown rows
      Given a query that has not run
      When the widget reads a column of its row
      Then the column is unknown rather than guessed
