@unit
Feature: haven startup time
  Every second before the API answers is spent by every developer and every
  diff run on every up. The measured timeline and the ranked proposals are in
  the haven startup report; these are the behaviours haven itself owns.

  # Each portless registration is a Node CLI start: 0.3s idle, seconds on a
  # loaded machine, and a stack registers about ten. portless locks its route
  # store, so the calls are safe side by side.
  Scenario: A stack's routes are registered side by side
    Given a stack with several routed services
    When haven provisions it
    Then every route is registered
    And the registrations run at the same time rather than one after another

  # Node 24 caches the TypeScript transform as well as V8 code. The lanes
  # already used a per-stack cache; the codegen, prepare and seed jobs did not,
  # so each paid a cold transform of its whole module graph on every up.
  Scenario: The one-shot jobs reuse the stack's Node compile cache
    Given a stack whose lanes cache compiled modules per stack
    When haven runs the codegen, prepare and seed jobs for an up
    Then each job runs with the same per-stack compile cache as the lanes
