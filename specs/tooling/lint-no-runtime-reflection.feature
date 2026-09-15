Feature: The no-runtime-reflection lint rule
  A module's shape is read at compile time. A Proxy standing in for a class, a
  Reflect call routing around a method, or Object.defineProperty patching an
  object that is not a class prototype hides behaviour a reader cannot find by
  reading the class. The one sanctioned exception is packages/test-harness's
  createApiFixture, which builds a throwaway test double, not production
  behaviour.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: new Proxy stands in for a class
    Given a governed module source file that constructs a Proxy
    When the no-runtime-reflection rule runs over it
    Then it reports proxy
    And the message tells the reader to write the class or app the module already declares

  @unit
  Scenario: Reflect.get reaches around a method call
    Given a governed module source file that calls Reflect.get
    When the no-runtime-reflection rule runs over it
    Then it reports reflect
    And the message names the Reflect member that was called

  @unit
  Scenario: Object.defineProperty patches a non-prototype object
    Given a governed module source file that calls Object.defineProperty on a plain object
    When the no-runtime-reflection rule runs over it
    Then it reports defineProperty

  @unit
  Scenario: Object.defineProperty on a class prototype is allowed
    Given a governed module source file that calls Object.defineProperty on a class prototype
    When the no-runtime-reflection rule runs over it
    Then it reports nothing

  @unit
  Scenario: A test file may use Proxy
    Given a __tests__ file that constructs a Proxy
    When the no-runtime-reflection rule runs over it
    Then it reports nothing

  @unit
  Scenario: createApiFixture's own Proxy is the sanctioned exception
    Given the packages/test-harness source that constructs a Proxy
    When the no-runtime-reflection rule runs over it
    Then it reports nothing
