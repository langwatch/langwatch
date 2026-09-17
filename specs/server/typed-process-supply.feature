Feature: A process cannot boot without what its modules declared

  Composing a process is answering one question: what do the modules I am
  installing need, and have I supplied it? Today that question is answered at
  boot, by a refusal naming a module and a member. It should be answered by the
  compiler, because everything needed to answer it is already declared — each
  module states the members it reads, the peers it depends on, the stores it
  keeps state in, and the shape of its own configuration.

  The supply is a fluent chain ending in `boot()`, which takes no arguments.
  Which calls are required is computed from what was installed, so a process
  installing one small module is asked for one small thing.

  Every scenario carries `@unimplemented` beside its binding tag: the contract is
  agreed and nothing implements it yet. A lane drops that tag on the scenarios it
  binds, in the same commit that binds them.

  Background:
    Given modules that each declare what they read, depend on and configure

  # ---------------------------------------------------------------------------
  # Only what was declared, and all of it
  # ---------------------------------------------------------------------------

  Rule: the supply required is exactly what the installed modules declared

    @unit @unimplemented
    Scenario: A process installing one module is asked only for that module's needs
      Given a single installed module that reads only a clock
      When the process supplies a clock
      Then it boots
      And it is never asked for a database, a cache or any door

    @unit @unimplemented
    Scenario: Supplying nothing names everything missing at once
      Given installed modules that between them need a database, a cache, a clock and configuration
      When the process supplies none of it
      Then the refusal names all four
      And it does not stop at the first

    @unit @unimplemented
    Scenario: A module that keeps no analytical state never asks for one
      Given installed modules that keep no analytical state
      Then the process is never asked to supply an analytical store

    @unit @unimplemented
    Scenario: Installing a module with configuration makes configuration required
      Given a process that needed no configuration
      When a module carrying its own settings is installed
      Then the process is asked for that module's settings by name

  Rule: a peer is satisfied by installing its module or by standing in for it

    @unit @unimplemented
    Scenario: Installing the module that owns a capability satisfies its dependents
      Given a module that depends on another module's capability
      When both modules are installed
      Then nothing further is supplied for that capability

    @unit @unimplemented
    Scenario: Standing in for a module that is not installed
      Given a module that depends on a capability whose module is not installed
      When the process stands in for that capability
      Then it boots
      And a capability neither installed nor stood in for is named as missing

  # ---------------------------------------------------------------------------
  # Stores
  # ---------------------------------------------------------------------------

  Rule: stores are built from the deployment's own configuration

    @unit @unimplemented
    Scenario: A configured deployment names no store
      Given a deployment whose configuration carries its connection strings
      When the process boots
      Then every store its modules need is opened from that configuration
      And the composition names none of them

    @unit @unimplemented
    Scenario: A store a module needs and the deployment did not configure
      Given an installed module that keeps relational state
      And a deployment that configured no database
      Then the boot refuses, naming the setting that would configure one

  Rule: choosing memory is an override, and an override against a real endpoint is said out loud

    @unit @unimplemented
    Scenario: A test runs a module over memory
      Given an installed module that keeps relational state
      When the process chooses memory for its relational store
      Then it boots without opening a database

    @unit @unimplemented
    Scenario: Choosing memory while a real endpoint is configured warns
      Given a deployment that configured a database
      When the process chooses memory for its relational store anyway
      Then it boots on memory
      And a warning names both the setting and the choice that overrode it

  # ---------------------------------------------------------------------------
  # Configuration
  # ---------------------------------------------------------------------------

  Rule: a setting the process did not mean to send is dropped, and every drop is reported

    @unit @unimplemented
    Scenario: A misspelled optional setting is dropped and named
      Given a module whose settings carry an optional field
      When the process sends that field under a misspelled name
      Then the module reads the field as unset
      And a warning names the module and the setting that was dropped

    @unit @unimplemented
    Scenario: A misspelled required setting refuses the boot
      Given a module whose settings carry a required field
      When the process sends that field under a misspelled name
      Then the boot refuses, naming the module and the field it did not receive

  # ---------------------------------------------------------------------------
  # Doors
  # ---------------------------------------------------------------------------

  Rule: a process that says nothing about doors opens none

    @unit @unimplemented
    Scenario: A process that serves no HTTP surface
      Given a process that configures no transport authentication
      When it installs a module that declares REST routes
      Then it boots
      And serving one of those routes refuses, naming the role that cannot serve it

    @unit @unimplemented
    Scenario: A process that serves
      Given a process that configures transport authentication
      When it installs a module that declares REST routes
      Then those routes answer

  Rule: a credential the deployment supplies is named, not spelled

    @unit @unimplemented
    Scenario: A misspelled shared secret is refused where it is written
      Given a process supplying the deployment's own shared secrets
      When one is given under a name no door guards
      Then it is refused where it was written, rather than guarding nothing

    @unit @unimplemented
    Scenario: A door whose credential was never supplied refuses callers
      Given a process that supplies no instance administrator bearer
      When a caller presents one
      Then the door refuses
      And the routes it guards stay mounted
