# The declarative process. See dev/docs/adr/144-declarative-process-composition.md
# and dev/docs/plans/composition-v2.md.
#
# A process is a role, a config, an infrastructure pool and a generated module
# list. A module declares everything it contributes; no application names a
# module. Scenarios tagged @unimplemented describe the agreed shape still to be
# built.

Feature: Composing a process declaratively

  Background:
    Given a module declares its server half with defineServerModule
    And the process holds one infrastructure pool

  @unit
  Scenario: A module names the pool members it reads
    Given a module that names "prefix" and "clock"
    And a pool that supplies both
    When the process boots
    Then the module's app is created with those members

  @unit
  Scenario: A pool member the module named is absent at boot
    Given a module that names "prefix" and "clock"
    And a pool that supplies "clock" as undefined
    When the process boots
    Then boot refuses naming the module and the member
    And no app is created

  @unit
  Scenario: The named members do not cover the module's interface
    Given a module whose infrastructure interface names "prefix" and "clock"
    When the module names only "prefix"
    Then the declaration reports the member it has not named

  @unimplemented
  Scenario: A pool that lacks a member an installed module names
    Given a module whose infrastructure interface names a member the pool lacks
    When the module list is installed
    Then the module list does not compile

  @unimplemented
  Scenario: A peer module is not infrastructure
    Given a module whose app names a peer api token
    When the process boots
    Then the peer arrives through the module graph
    And the pool holds no api

  @unimplemented
  Scenario: A missing peer refuses by name
    Given a module whose app names a peer no installed module provides
    When the process boots
    Then boot refuses naming the peer

  @unimplemented
  Scenario: A role reads only the declarations addressed to it
    Given a module that declares transports, workers and tasks
    When the process boots with role "worker"
    Then the declared workers start
    And no transport is mounted

  @unimplemented
  Scenario: A route declares the credential kind it answers behind
    Given a family whose default credential is "organization"
    And a route that declares "instance-admin"
    When a caller reaches that route
    Then the runtime resolves the instance-admin credential
    And the handler reads the actor and scope that kind resolves

  @unimplemented
  Scenario: A route declares the trail it leaves
    Given a route that declares an audit action
    When the route answers successfully
    Then the runtime writes one audit row from the actor, the params and the result id

  @unimplemented
  Scenario: A refused route leaves the refusal on the trail
    Given a route that declares an audit action
    When the route throws a handled error
    Then the runtime writes one audit row carrying the error code

  @unimplemented
  Scenario: The module list is generated from the catalogue
    Given the catalogue lists a core module and an enterprise module
    When the open-source build generates the module list
    Then the enterprise module is absent from the generated file

  @unimplemented
  Scenario: The wire is pinned across a conversion
    Given a module that moves from the hand-written composition to the module list
    When the address inventory is generated
    Then every method, path and credential kind is unchanged
