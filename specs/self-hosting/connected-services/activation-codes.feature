Feature: Activating a self-hosted install with a code
  A fresh install pastes a short code instead of a license blob. The install
  posts it to LangWatch, which mints the license the code describes and returns
  it signed. The license paste stays for an install that cannot reach the
  internet.

  The registry holds a hash of the code, never the code. Every lookup hashes
  what the caller presented first, so reading the table gives somebody a value
  that hashes to something else.

  As a customer who just bought LangWatch
  I want to type one short line into my install
  So that it has its license without anybody emailing a key around

  # ============================================================================
  # What a code is
  # ============================================================================

  @unit
  Scenario: A code is read back however it was typed
    Given a code issued as LW-A1B2-C3D4-E5F6-G7H8
    When it is typed in lower case, with extra spaces, or with the dashes left out
    Then it is the same code every time

  @unit
  Scenario: The stored hash is not itself a usable code
    Given a code and the hash the registry stores for it
    When somebody presents that hash as a code
    Then it is refused, because the route hashes what was presented before looking it up

  @unit
  Scenario: A minted code uses no character a person would misread
    When a code is minted
    Then it carries no I, L, O or U

  @integration
  Scenario: A code names the hosted services the license may call
    Given an operator issuing an activation code in the backoffice
    When the operator fills in the customer and issues the code
    Then every hosted service is included unless the operator unticks it
    And the license the code mints names those services, so the install syncs and refreshes on its own

  @integration
  Scenario: A list of codes that cannot be read says so
    Given an operator on the activation-code list in the backoffice
    When the list of codes cannot be read
    Then the screen names the failure instead of reading as an empty registry

  @integration
  Scenario: A revoke that fails tells the operator who asked for it
    Given an operator on the activation-code list in the backoffice
    When revoking a code fails
    Then the operator is told, rather than the click passing for done

  # ============================================================================
  # Redeeming
  # ============================================================================

  @unit
  Scenario: A valid code mints the license it describes
    Given a single-use code for a customer on the enterprise plan
    When an install redeems it
    Then a license is signed for that customer with the seats the code names
    And the license term is counted from the day it was redeemed
    And the code records which install redeemed it

  @unit
  Scenario: A code must be presented with an instance id
    Given a valid code
    When it is redeemed with no instance id
    Then it is refused, and nothing is minted

  @unit
  Scenario: A revoked code reads exactly like one that was never issued
    Given a revoked code
    When an install redeems it
    Then the refusal says the code is not one we issued
    And it says nothing about the customer it belonged to

  @unit
  Scenario: An expired code is refused
    Given a code past its expiry
    When an install redeems it
    Then it is refused as expired, and nothing is minted

  @unit
  Scenario: Too many attempts on one code are refused
    Given a code attempted more times than the limit allows
    When another attempt arrives
    Then it is refused as rate limited before the registry is read

  # ============================================================================
  # Exactly once
  # ============================================================================

  @unit
  Scenario: A single-use code is redeemed by exactly one of two simultaneous installs
    Given two installs posting the same single-use code with no write landing between them
    When both are redeemed
    Then exactly one is told yes
    And the other is told the code has already been used
    And exactly one license is minted

  @integration
  Scenario: The database decides which install wins, not the process
    Given a single-use code in the registry
    When five installs redeem it at once
    Then the row records one redemption
    And four callers are refused

  @unit
  Scenario: A claim whose license could not be signed is released again
    Given a code whose license signing fails
    When an install redeems it
    Then the failure travels on
    And the code is redeemable again rather than burned

  @unit
  Scenario: A reusable code is redeemed by every install that presents it
    Given a reusable code
    When three installs redeem it
    Then all three get a license
    And the code counts three redemptions

  # ============================================================================
  # On the install
  # ============================================================================

  @unit
  Scenario: The install stores what the code minted exactly as a pasted license
    Given an install redeeming a code
    When LangWatch answers with a signed license
    Then the install validates and stores it the way it stores a pasted one

  @unit
  Scenario: An install with connect switched off refuses to redeem
    Given an install with connect switched off
    When an operator enters a code
    Then it is refused with the reason, and no call leaves the install
