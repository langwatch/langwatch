Feature: The namespace-class lint rule
  A strict feature server class earns its name by holding state. A class whose
  every member is static is a module wearing a class: plain functions hidden
  behind a namespace and a create nobody calls. Pure behaviour lives as
  functions in a rules/ module.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A class with only static members is reported as a module wearing a class
    Given a server module whose class has two or more static members and no instance member
    When the namespace-class rule runs over it
    Then it reports namespaceClass naming the class and the member count
    And a static create beside the statics does not excuse it

  @unit
  Scenario: A class with instance members is left alone
    Given a server module whose class has a static create and instance methods
    When the namespace-class rule runs over it
    Then it reports nothing
