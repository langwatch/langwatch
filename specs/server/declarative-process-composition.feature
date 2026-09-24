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

  @unit
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

  @unit
  Scenario: A role reads only the declarations addressed to it
    Given a module that declares transports, workers and tasks
    When the process boots with role "worker"
    Then the declared workers start
    And no transport is mounted

  @integration
  Scenario: A route declares the credential kind it answers behind
    Given a family whose default credential is "organization"
    And a route that declares "instance-admin"
    When a caller reaches that route
    Then the runtime resolves the instance-admin credential
    And the handler reads the actor and scope that kind resolves

  @integration
  Scenario: A route declares the trail it leaves
    Given a route that declares an audit action
    When the route answers successfully
    Then the runtime writes one audit row from the actor, the params and the result id

  @integration
  Scenario: A refused route leaves the refusal on the trail
    Given a route that declares an audit action
    When the route throws a handled error
    Then the runtime writes one audit row carrying the error code

  @unit
  Scenario: A module declares its event sourcing beside its transports
    Given a module that declares a pipeline with defineEventingModule
    When the process boots with an eventing runtime on its pool
    Then the pipeline is built over the module's own repositories and app
    And it is built against the process store of the graph that installs it
    And the senders registration answers with reach the module

  @unit
  Scenario: A pipeline reads its own aggregate's earlier events
    Given a module whose pipeline declares the simulation_run aggregate
    When one of its commands reads a run's earlier events through its eventing setup
    Then the process's event log is read for that run under the simulation_run aggregate type only
    And only the events the command's guard accepts come back

  @unit
  Scenario: A module hosts several pipelines
    Given a module that calls withEventing once for each of three pipelines
    When the process boots with an eventing runtime on its pool
    Then the three register in the order declared, each connected to its own senders

  @unit
  Scenario: A role that runs no event sourcing ignores the declaration
    Given a module that declares a pipeline with defineEventingModule
    When the process boots with no eventing runtime on its pool
    Then the module's app is created
    And no pipeline is built or registered

  @unit
  Scenario: The module list is generated from the catalogue
    Given the catalogue lists a core module and an enterprise module
    When the open-source build generates the module list
    Then the enterprise module is absent from the generated file

  @unimplemented
  Scenario: The wire is pinned across a conversion
    Given a module that moves from the hand-written composition to the module list
    When the address inventory is generated
    Then every method, path and credential kind is unchanged

  # The tasks role. A module declares one-shot work with withTasks, and the
  # tasks process reads it back from the booted runtime. The kernel holds no
  # task type of its own -- it depends on zod and nothing else -- so the caller
  # names the shape and the kernel checks each contribution against it.

  @unit
  Scenario: The tasks role collects the one-shot work modules declared
    Given two modules that each declare one task with withTasks
    When a process with the "tasks" role boots and is asked for its tasks
    Then it answers with both, in installation order

  @unit
  Scenario: A process that is not the tasks role has no tasks to give
    Given a module that declares one task with withTasks
    When a process with the "worker" role boots and is asked for its tasks
    Then it refuses, naming the role it actually is

  @unit
  Scenario: A module that declared something other than a task is named
    Given a module whose withTasks call received a value that is not a task
    When a process with the "tasks" role boots and is asked for its tasks
    Then it refuses, naming the module that declared it

  @unit
  Scenario: A bundle-only API builds a handler without running worker contributions
    Given installed modules with worker contributions and a selected browser bundle
    When the API boots with producing pipelines
    Then it builds its HTTP handler without constructing worker contributions

  @unit
  Scenario: Worker services start after boot and drain before their module closes
    Given a worker with consuming pipelines and a module-owned service
    When the worker boots and its runtime starts
    Then the service starts after boot
    And shutdown drains the service before releasing its module
