Feature: Licence journeys on a self-hosted stack
  An administrator activates, replaces and loses a licence through the product.
  Every key here is a labelled test value; variants are minted at test time from
  the committed test keypair, which the stack trusts through LANGWATCH_LICENSE_PUBLIC_KEY
  exactly as e2e-ci already configures it. Plan: L02, L03, L05, L06, L07, L11.

  # sh-licensed: LANGWATCH_LICENSE_PUBLIC_KEY is the test public key and
  # LANGWATCH_LICENSE_KEY is the test enterprise licence.

  @e2e @sh-licensed
  Scenario: A configured licence entitles the organization before anything is pasted
    Given the stack runs in deployment mode "sh-licensed" with a configured test licence
    And the organization has no pasted licence
    When the administrator asks for each enterprise feature in the sweep
    Then every enterprise feature answers

  @e2e @sh-licensed
  Scenario: An administrator pastes a valid licence key on the licence page
    Given the stack runs in deployment mode "sh-licensed"
    And the organization has no pasted licence
    When the administrator pastes the test enterprise licence on the licence page
    And activates it
    Then the licence page shows the licence as "Valid" on the "Enterprise" plan

  @e2e @sh-licensed
  Scenario: A licence with one payload byte changed is refused
    Given the stack runs in deployment mode "sh-licensed"
    When the administrator uploads the test licence with its organization name edited
    Then the upload is refused with "license_key_invalid"
    And the organization still has no pasted licence

  @e2e @sh-licensed
  Scenario: A licence signed by a key the stack does not trust is refused
    Given the stack runs in deployment mode "sh-licensed"
    When the administrator uploads a licence signed by another key
    Then the upload is refused with "license_key_invalid"
    And the organization still has no pasted licence

  @e2e @sh-licensed
  Scenario: A licence whose plan was swapped after signing is refused
    Given the stack runs in deployment mode "sh-licensed"
    When the administrator uploads a Pro licence whose plan was rewritten to Enterprise
    Then the upload is refused with "license_key_invalid"

  @e2e @sh-licensed
  Scenario: Text that is not a licence is refused
    Given the stack runs in deployment mode "sh-licensed"
    When the administrator uploads a key that does not decode as a licence
    Then the upload is refused with "license_key_invalid"

  @e2e @sh-licensed
  Scenario: An expired licence is refused on upload
    Given the stack runs in deployment mode "sh-licensed"
    When the administrator uploads a correctly signed licence that expired last year
    Then the upload is refused with "license_expired"
    And the organization still has no pasted licence

  @e2e @sh-licensed
  Scenario: An invite beyond a one-seat licence is refused, and the same invite succeeds with seats
    Given the stack runs in deployment mode "sh-licensed"
    And the organization holds a correctly signed licence with one seat
    When the administrator invites a new member
    Then the invite is refused with a client error and no invite is created
    When the administrator replaces it with the test enterprise licence
    And invites the same member again
    Then the invite is created

  @e2e @sh-free
  Scenario: Every enterprise feature is mounted and refuses an organization without a licence
    Given the stack runs in deployment mode "sh-free"
    And the organization has no pasted licence
    When the administrator asks for each enterprise feature in the sweep
    Then every enterprise feature refuses with a client error that is not "not found"

  @e2e @sh-free
  Scenario: A forged licence does not unlock an unlicensed stack
    Given the stack runs in deployment mode "sh-free"
    When the administrator uploads a licence signed by another key
    And the administrator uploads the test licence with its plan rewritten to raise its seats
    Then each upload is refused with "license_key_invalid"
    And every enterprise feature in the sweep still refuses
