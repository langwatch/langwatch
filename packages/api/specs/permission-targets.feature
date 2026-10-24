# A route that asks a permission at more than one scope its input names (ADR-185 §2, §7, §9).
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

  Rule: A tRPC procedure composes two targets the way a REST route does

    @unit
    Scenario: A procedure asking two targets asks both before its handler
      Given a procedure declaring "project:view" at its "projectId" and "traces:view" at the project its "readerProjectId" names
      And the caller holds both permissions at both projects
      When the caller calls the procedure
      Then the door asks "project:view" at the owner project, then "traces:view" at the reader project
      And the handler runs

    @unit
    Scenario: A procedure refuses a caller the second target refuses, before its handler
      Given a procedure declaring a permission at its owner project and another at its reader project
      And the caller holds the reader's permission nowhere
      When the caller calls the procedure
      Then the answer is FORBIDDEN permission_denied naming the reader project
      And the handler never runs

    @unit
    Scenario: A procedure's handler is handed one proof per proof-bearing target
      Given a procedure declaring "traces:view" at its owner project and at its reader project
      When a caller holding both calls the procedure
      Then the handler is handed a proof minted for the owner project, under "projectId"
      And a proof minted for the reader project, under "readerProjectId"
      And its single "authorization" is still the first target's proof
      And a procedure asking one target is handed no proofs by field

    @unit
    Scenario: A procedure's further permission the composition cannot honour is refused at declaration
      Given a procedure that already declared its access
      When it declares a further permission after a set or a platform permission, with no target, at a scope field, at a field it already named, or at a field its input does not carry
      Then the declaration is refused naming the procedure

  Rule: A credential is held to its own limits at every target

    @unit
    Scenario: A key lacking the second permission is refused though its owner holds it
      Given a REST route declaring a permission at its owner project and another at its reader project
      And an API key whose own permissions hold only the first, owned by a person holding both
      When the key calls the route
      Then the key door is asked both permissions under the key's own limits
      And the answer is 403 and the handler never runs

    @unit
    Scenario: A caller bound to one project is refused at a further target naming another
      Given a procedure declaring a permission at its owner project and another at its reader project
      And a caller whose credential resolved the owner project
      When the caller names another project as the reader
      Then the answer is FORBIDDEN scope_input_mismatch
      And the handler never runs

  Rule: A project-scoped plan gate reads the project's organization

    @unit
    Scenario: A project-scoped Enterprise gate below Enterprise answers 402 enterprise_plan_required
      Given a route gated on the Enterprise plan whose scope is a project
      When the project's organization is on a plan below Enterprise
      Then the door reads the plan of the organization holding the project
      And the gate does not hold, so the route answers 402 enterprise_plan_required
      And on an Enterprise organization the gate holds
