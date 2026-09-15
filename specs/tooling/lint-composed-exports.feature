Feature: The composed-exports lint rule
  A service, adapter, repository, process or transport factory that a server
  package publishes must be constructed somewhere the application entrypoints
  actually reach. A capability nobody composes is not a capability, however
  green its unit tests are, and a commit message that declares a seam closed is
  not evidence the call site changed.

  Background:
    Given a workspace whose api entrypoint reaches one composition root

  @unit
  Scenario: An export no application constructs is reported
    Given a server package exporting a service the composition never builds
    When the composed-exports rule runs over the workspace
    Then it reports the service by name and by owning package
    And the message says to compose it in the owning composition or delete it

  @unit
  Scenario: An export the composition constructs is accepted
    Given a server package exporting a service the composition constructs
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that service

  @unit
  Scenario: A transport factory nothing mounts is reported
    Given a server package exporting a REST factory no application mounts
    When the composed-exports rule runs over the workspace
    Then it reports the factory by name

  @unit
  Scenario: Re-exporting a class is not composing it
    Given a barrel on the reachable graph that only re-exports a service
    When the composed-exports rule runs over the workspace
    Then the service is still reported as composed by no application

  @unit
  Scenario: Naming a class in a comment is not composing it
    Given a reachable composition that names a service only in a comment
    When the composed-exports rule runs over the workspace
    Then the service is still reported as composed by no application

  @unit
  Scenario: Naming a class only as a type is not composing it
    Given a reachable module that names a service only in a type annotation
    When the composed-exports rule runs over the workspace
    Then the service is still reported as composed by no application

  @unit
  Scenario: A testing export is not required to be composed
    Given a server package exporting a service from a testing module
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that service

  @unit
  Scenario: An abstract port is not required to be composed
    Given a server package exporting an abstract port class
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that port

  @unit
  Scenario: An error class is not required to be composed
    Given a server package exporting a class that extends an error
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that error

  @unit
  Scenario: A schema export is not required to be composed
    Given a server package exporting a zod schema and its inferred type
    When the composed-exports rule runs over the workspace
    Then it reports nothing for the schema

  @unit
  Scenario: A web package is not read at all
    Given a web package exporting a service the applications never build
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that service

  @unit
  Scenario: A contract package is not read at all
    Given a contract package exporting a service the applications never build
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that service

  @unit
  Scenario: A baselined export is accepted while it stays baselined
    Given an uncomposed export listed in the composed-exports baseline
    When the composed-exports rule runs over the workspace
    Then it reports nothing for that export

  @unit
  Scenario: The baseline may only shrink
    Given a baseline carrying an entry the merge base does not carry
    When the composed-exports baseline is compared against the merge base
    Then the new entry is reported as a growth the baseline does not allow

  @unit
  Scenario: An entry the merge base carried may be removed
    Given a baseline with one fewer entry than the merge base
    When the composed-exports baseline is compared against the merge base
    Then nothing is reported

  @unit
  Scenario: A baseline entry without a measured date is refused
    Given a composed-exports baseline entry with no measured date
    When the baseline is read
    Then it is reported as invalid
