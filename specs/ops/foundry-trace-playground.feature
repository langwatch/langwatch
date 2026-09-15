Feature: The Foundry trace playground

  Operators shape a trace by hand at `/ops/foundry` and send it to this
  deployment's own collector, which is how an ingestion change is proved
  against real spans before anybody's traces meet it.

  # The page is a browser bundle: the module that builds the exporter is loaded
  # by the browser as the page opens. A module that will not resolve or parse
  # is a transform failure and the whole page reads "This page did not load" —
  # nothing about the Foundry itself survives that, so the import graph is
  # worth a test of its own.
  @unit
  Scenario: The Foundry's browser exporter is loadable on the page that mounts it
    Given an operator opens the Foundry
    When the page builds its exporter for this deployment
    Then the exporter is built rather than the page failing to load
