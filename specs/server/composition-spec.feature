# The composition specification. See dev/docs/adr/133-composition-spec.md.
#
# One feature installer, one construction path, explicit lifecycle. A feature
# declares what it needs; boot validates and constructs; start serves. Imports
# and constructors never start background work.
#
# Scenarios tagged @unimplemented describe the container that does not exist
# yet. The rest are bound to tests that already prove the behaviour in the one
# role that has it, usually the worker.

Feature: Composing a process from feature installers
  Every process installs the same features the same way, validates the whole
  graph before it serves, and closes what it opened in reverse order.

  Rule: a declaration is validated before anything is constructed

    @unimplemented @unit
    Scenario: Installing the same feature twice fails the boot
      Given an application root that declares a feature
      When the same feature is declared a second time
      Then boot fails naming the feature and the token it provides twice
      And no service of that feature is constructed

    @unimplemented @unit
    Scenario: A feature whose dependency nobody provides never serves
      Given a feature that requires a contract service
      And an application root where no installed feature provides it
      When the application boots
      Then boot fails naming the feature, the dependency key and the token
      And the process never becomes ready
      And no transport accepts a request

  Rule: a role installs only the work that role owns

    @unit
    Scenario: The API role installs no event consumers
      Given an API process composed with its own Eventing runtime
      When a pipeline carrying a process manager is registered
      Then the pipeline is registered so its commands still send
      And the process manager is declined rather than run
      And asking the runtime for a process runtime refuses as producer-only

    @unit
    Scenario: The worker installs each feature consumer exactly once
      Given a worker application with one feature installer
      When two starts race against each other
      Then the installer installs once
      And both callers share the one started application

    @unimplemented @unit
    Scenario: Both transports answer from one constructed service
      Given a feature exposing one operation over REST and over tRPC
      When each door serves a request for that operation
      Then both reach the same service instance the setup constructed
      And neither door constructs a service of its own

    @unit
    Scenario: The browser application installs one session for every feature
      Given the standing declaration apps/ui serves itself
      When the installed features are read
      Then one session is installed for the whole application
      And each feature mounts its own transport provider over it

  Rule: a lifecycle that fails cleans up what it acquired

    @unit
    Scenario: A failed installation closes what was already installed
      Given a worker application with two feature installers
      And the second installer fails
      When the application starts
      Then the start fails
      And the feature installed first is closed

    @unit
    Scenario: Shutdown drains in-flight work before releasing infrastructure
      Given a worker application serving feature consumers
      When the application closes
      Then Eventing drains first
      And the features close after the drain
      And the runtime infrastructure is released last

  Rule: a blocking migration gates readiness, and resumable work resumes

    @unimplemented @integration
    Scenario: A blocking startup migration holds every replica out of readiness
      Given a migration declared to block startup
      And several replicas booting against one database
      When the migration has not finalized for every tenant in its cohort
      Then no replica reports ready
      And a replica whose pass failed, parked, or was intervened on stays unready
      And readiness opens only once completion is asserted, not once movement stops

    @unit
    Scenario: A restart skips the tenants an earlier pass finalized
      Given a tenant recorded as finalized by an earlier pass
      When a later pass runs
      Then the migration is never called for that tenant

    @unit
    Scenario: A background migration resumes from its persisted checkpoint
      Given a tenant whose previous attempt parked partway
      When the next pass runs
      Then the migration receives that record
      And it continues the stranded work rather than starting again
