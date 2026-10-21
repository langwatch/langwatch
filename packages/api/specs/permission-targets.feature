# A route that asks a permission at more than one scope its input names (ADR-183 §2, §7, §9).
# CLAUDE.md rule 6: the door asks every target before the handler runs; no handler checks one.
Feature: A route asks a permission at each of several targets before its handler
  A braid joins two projects, so the routes that write or preview one ask a permission at each
  project the route names. The door asks every target, in declared order, before the handler
  runs; refusing any one is the refusal a single permission gives. A proof-bearing permission
  mints one proof per target, so the handler reads each project under its own proof.

  Rule: Two route targets compose, and the door asks both

    @unit
    Scenario: A route asking two targets serves a caller holding both
      Given a route declaring "project:view" at its owner project and "traces:view" at its reader project
      And the caller holds both permissions at both projects
      When the caller calls the route
      Then the door asks "project:view" at the owner project, then "traces:view" at the reader project
      And the handler runs

    @unit
    Scenario: A route refuses a caller the second target refuses, before its handler
      Given a route declaring a permission at its owner project and another at its reader project
      And the caller holds the reader's permission nowhere
      When the caller calls the route
      Then the answer is 403 permission_denied, after both projects were asked
      And the handler never runs

    @unit
    Scenario: A route refuses a caller the first target refuses, before its handler
      Given a route declaring a permission at its owner project and another at its reader project
      And the caller holds the owner's permission nowhere
      When the caller calls the route
      Then the answer is 403 permission_denied
      And the reader project is never asked
      And the handler never runs

    @unit
    Scenario: A route's handler is handed one proof per proof-bearing target
      Given a route declaring "traces:view" at its owner project and at its reader project
      When a caller holding both calls the route
      Then the handler is handed a proof minted for the owner project, under the owner's field
      And a proof minted for the reader project, under the reader's field
      And its single "authorization" is still the first target's proof

    @unit
    Scenario: A second permission without a route target of its own is refused at declaration
      Given a route that already declared a permission
      When it declares another with no route target, at the target it already named, or after a set or an input choice
      Then the declaration is refused naming the route

  Rule: A project-scoped plan gate reads the project's organization

    @unit
    Scenario: A project-scoped Enterprise gate below Enterprise answers 402 enterprise_plan_required
      Given a route gated on the Enterprise plan whose scope is a project
      When the project's organization is on a plan below Enterprise
      Then the door reads the plan of the organization holding the project
      And the gate does not hold, so the route answers 402 enterprise_plan_required
      And on an Enterprise organization the gate holds
