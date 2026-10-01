Feature: The web-state lint rules
  Browser state has four homes (dev/docs/ARCHITECTURE.md §10.2): React Query for
  server data, the router for address-bar state, one module-private zustand
  store per feature under behavior/, and local useState derived during render.
  Four rules hold the line: effect-derives-state, query-data-in-state,
  browser-store-containment and no-redux.

  @unit
  Scenario: An effect that only derives state is reported
    Given a component whose effect only calls its own useState setter with a value computed from props
    When the effect-derives-state rule runs over it
    Then it reports the effect

  @unit
  Scenario: An effect that subscribes, times, touches the DOM or cleans up is left alone
    Given a component whose effect subscribes, starts a timer, reads the DOM or returns a cleanup
    When the effect-derives-state rule runs over it
    Then it reports nothing

  @unit
  Scenario: Query data copied into state is reported
    Given a component that copies a query's data into a useState setter
    When the query-data-in-state rule runs over it
    Then it reports the copy

  @unit
  Scenario: A zustand store outside behavior is reported
    Given a browser package that calls zustand's create in a file outside behavior/
    When the browser-store-containment rule runs over it
    Then it reports the store

  @unit
  Scenario: A package declaration file exporting a store is reported
    Given a module's web declaration file that exports a store hook
    When the browser-store-containment rule runs over it
    Then it reports the export

  @unit
  Scenario: A Redux import in browser code is reported
    Given a browser file that imports @reduxjs/toolkit
    When the no-redux rule runs over it
    Then it reports the import
