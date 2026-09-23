Feature: The module-classes lint rule
  Each module artifact exports the class shape ARCHITECTURE.md §3.2 gives it.
  A process service, app, migration or repository backend exports one
  concrete class of its suffix, built through `static create`; a service's
  create is a method and its constructor is private, so nothing bypasses
  create. A repository backend on `PrismaRepository.for(...)` may inherit its
  create as `static readonly create = this.factory(...)`. An interface file (a
  repository interface, a contract service, a contract app) exports an
  interface or an abstract class. No artifact exports behaviour as a
  standalone function.

  Background:
    Given a workspace whose agent module has a contract and a process half

  @unit
  Scenario: A standalone exported function is reported by name and line
    Given a service module that exports a function or an arrow const beside its Service class
    When the module-classes rule runs over it
    Then it reports standalone on the function's line, naming the function and the class it belongs on

  @unit
  Scenario: A module file missing its class is reported
    Given a service module that exports no concrete class ending in Service
    When the module-classes rule runs over it
    Then it reports missingConcrete

  @unit
  Scenario: A concrete class without static create is reported
    Given a service, app, migration or repository backend whose concrete class has no static create
    When the module-classes rule runs over it
    Then it reports create on the class, naming the create spelling that module may use

  @unit
  Scenario: A service's create is a method, a Prisma backend may inherit it
    Given a class whose create is the inherited factory property
    When the module-classes rule runs over it
    Then it reports create when the class is a service
    But it accepts the property on a repository backend

  @unit
  Scenario: A constructor that is not private beside static create is reported
    Given a Service class with static create and a public or undeclared constructor
    When the module-classes rule runs over it
    Then it reports publicConstructor on the constructor, or on the class when none is declared

  @unit
  Scenario: An interface file without its interface is reported
    Given a repository interface file or a contract service file that exports only a concrete class
    When the module-classes rule runs over it
    Then it reports missingDeclared naming the suffix

  @unit
  Scenario: A well-formed module class is left alone
    Given a module file that exports the class shape its artifact requires
    When the module-classes rule runs over it
    Then it reports nothing

  @unit
  Scenario: A file that is no module class artifact is left alone
    Given a rules module that exports pure functions
    When the module-classes rule runs over it
    Then it reports nothing
