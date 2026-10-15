Feature: Developer testing licenses
  A developer who needs a license-gated feature on their own stack asks Cloud
  for a testing license. A Cloud admin signs in, checks the request, picks how
  long it lasts and approves it. The license is real: signed on Cloud, bound to
  one instance and one local organization, refused once expired. Development
  inside the open-source plan needs no license at all. ADR-180.

  As a LangWatch developer
  I want a short-lived real license for my own stack
  So that I can test gated features without keys or overrides on my machine

  # ============================================================================
  # Seeded local data
  # ============================================================================

  @unit
  Scenario: Seeded local rows get random ids
    When the storage seed creates the local organization, team, project and admin user
    Then each row has a freshly generated id rather than a fixed one
    And two databases seeded separately share none of those ids

  @unit
  Scenario: Seeding again finds the rows it already made
    Given a database the storage seed already ran on
    When the storage seed runs again
    Then it updates the same organization, team, project and admin user by slug and email
    And it creates no second copy of any of them

  # ============================================================================
  # The license itself
  # ============================================================================

  @unit
  Scenario: A testing license carries its kind and its instance
    When Cloud signs a testing license
    Then the signed license says it is a testing license
    And it names the instance and the local organization it was approved for

  @unit
  Scenario: A license with no kind is a standard license
    Given a license signed before testing licenses existed
    When an install reads it
    Then it is treated as a standard license, exactly as before

  @unit
  Scenario: A testing license is refused on another instance or organization
    Given a testing license approved for one instance and one local organization
    When it is uploaded on a different instance, or for a different organization
    Then it is refused with a code naming the mismatch
    And no plan or feature is granted

  @unit
  Scenario: An expired testing license grants nothing, without a restart
    Given an install holding a testing license
    When its expiry passes while the api and worker keep running
    Then plan reads fall back to the open-source plan
    And single sign-on and other gated features stop answering as licensed

  @unit
  Scenario: An expired standard license keeps today's behaviour
    Given an install holding a standard license past its expiry
    When the plan is read
    Then the answer is the same as before testing licenses existed

  @unit
  Scenario: A testing license cannot be reset onto another instance or turned standard
    Given a testing license in the registry
    When an operator resets its instance binding, or reissues it
    Then the reset is refused
    And the reissued license is still a testing license for the same instance and organization

  # ============================================================================
  # Asking and approving
  # ============================================================================

  @unit
  Scenario: An instance asks for a testing license and gets two codes
    When an instance starts a testing license request for one of its organizations
    Then Cloud answers with a short code and a URL for a person
    And a separate private code that only the instance keeps
    And the request expires after ten minutes unless it is approved

  @unit
  Scenario: A Cloud admin approves a request and picks how long it lasts
    Given a pending testing license request
    When a Cloud admin approves it without choosing a length
    Then the license will last 5 days from approval
    When a Cloud admin approves another request choosing 12 hours
    Then that license will last 12 hours from approval

  @unit
  Scenario: An approval longer than the limit is refused
    Given a pending testing license request
    When a Cloud admin approves it choosing 45 days
    Then the approval is refused with a code naming the limit of 30 days

  @unit
  Scenario: Only a Cloud admin who may manage licenses can approve
    Given a pending testing license request
    When a signed-in user without ops:manage tries to approve it
    Then the approval is refused before the handler runs
    And the request stays pending

  @unit
  Scenario: The instance waits while the request is pending, then redeems it once
    Given a pending testing license request
    When the instance redeems its private code before approval
    Then it is told the request is still pending
    When the request is approved and the instance redeems again
    Then it receives the testing license and stores it
    And redeeming the same code a second time does not issue a second license

  @unit
  Scenario: A lost answer to a redemption can be recovered
    Given an approved request whose redemption answer never reached the instance
    When the instance redeems the same private code again
    Then it receives the same license, not a new one

  @unit
  Scenario: The short code alone cannot redeem a license
    Given a pending testing license request
    When anyone presents only the short code for redemption
    Then it is refused

  # ============================================================================
  # Ops pages
  # ============================================================================

  @unit
  Scenario: Testing licenses are hidden from the license list until asked
    Given a standard license and a testing license in the registry
    When an operator opens the license list
    Then only the standard license is listed and counted
    When the operator asks to include testing licenses
    Then the testing license is listed with a Testing badge, its approver, instance and expiry

  @unit
  Scenario: Testing licenses never count towards seats or invoices
    Given a customer with a standard license and a testing license
    When their seats and contract totals are computed
    Then the testing license adds nothing

  # ============================================================================
  # haven
  # ============================================================================

  @unit
  Scenario: haven asks for a testing license only when told to
    When haven starts a stack without asking for a testing license
    Then it does not contact Cloud for a license and opens no browser

  @unit
  Scenario: haven opens the approval page and waits for the license
    When haven starts a stack asking for a testing license
    Then it prints the short code and URL and opens the URL in the browser
    And it never prints the private code
    And once the request is approved it stores the license and finishes the gated seeding

  @unit
  Scenario: An agent asks without a browser and resumes later
    When haven is asked for a testing license in agent mode without opening a browser
    Then it reports the URL, short code and expiry and returns without waiting
    And a later wait command picks the request up and stores the license once approved
