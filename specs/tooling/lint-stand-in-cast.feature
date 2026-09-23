Feature: The stand-in-cast lint rule
  A cast through unknown or any is a type hole with a comment attached: the
  value is whatever it was at runtime and the reader is told otherwise. In
  production, fix the type, or parse the value at the seam where it arrives.
  A test file has no trust boundary to parse at, so it gets its own message:
  build the stub to the real shape instead of casting past the compiler. A
  lone `as any` is the native `typescript/no-explicit-any` rule's, and a cast
  over `as const` only widens a frozen literal, so neither is reported here.

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
  Scenario: A lone cast to any is left to no-explicit-any
    Given a governed source file that casts a value to any, with as and with the angle-bracket form
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A cast over as const is a single cast
    Given a governed source file that widens an as const literal with a second cast, and casts another value through unknown
    When the stand-in-cast rule runs over it
    Then it reports doubleCast only for the cast through unknown, on its line

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
  Scenario: A double cast inside a test reports the test message
    Given a test file that casts through unknown to build a double
    When the stand-in-cast rule runs over it
    Then it reports doubleCastInTest
    And the message tells the reader to build the stub to the target's real shape

  @unit
  Scenario: A const assertion in a test is left alone
    Given a test file that freezes a literal with as const
    When the stand-in-cast rule runs over it
    Then it reports nothing

  @unit
  Scenario: A stand-in cast outside the governed roots is not reported
    Given a file outside the governed roots that casts through unknown
    When the stand-in-cast rule runs over it
    Then it reports nothing
