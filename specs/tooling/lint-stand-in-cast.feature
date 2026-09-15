Feature: The stand-in-cast lint rule
  A cast through unknown or any is a type hole with a comment attached: the
  value is whatever it was at runtime and the reader is told otherwise. Fix
  the type, or parse the value at the seam where it arrives.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A cast through unknown is a stand-in for the type
    Given a governed source file that casts a value through unknown
    When the stand-in-cast rule runs over it
    Then it reports doubleCast
    And the message names the type it passes through and the type it lands on

  @unit
  Scenario: A cast through any is reported once, as one hole
    Given a governed source file that casts a value through any
    When the stand-in-cast rule runs over it
    Then it reports doubleCast once

  @unit
  Scenario: A cast to any drops the type
    Given a governed source file that casts a value to any
    When the stand-in-cast rule runs over it
    Then it reports anyCast

  @unit
  Scenario: The angle-bracket cast to any drops the type too
    Given a governed source file that casts a value to any with the angle-bracket form
    When the stand-in-cast rule runs over it
    Then it reports anyCast

  @unit
  Scenario: An as const assertion is allowed
    Given a governed source file that freezes a literal with as const
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A single cast to a named type is allowed
    Given a governed source file that casts a value once to a named type
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A satisfies check is allowed
    Given a governed source file that checks a value with satisfies
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A stand-in cast in a test file is not governed
    Given a test file that casts through unknown to build a double
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A stand-in cast outside the governed roots is not reported
    Given a file outside the governed roots that casts through unknown
    When the stand-in-cast rule runs over it
    Then it reports nothing
