Feature: The key a deployment verifies licences with
  Release builds verify licences against the embedded LangWatch key only.
  Development and test builds may name another verifying key through
  LANGWATCH_LICENSE_PUBLIC_KEY, so licences signed by the committed test key
  work on dev stacks and in the end-to-end suites.

  # ============================================================================
  # Release builds
  # ============================================================================

  @unit
  Scenario: A release build ignores the public-key override and verifies with the embedded key
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY names another public key
    When a licence signed by the LangWatch production key is activated
    Then the licence is accepted
    And licence verification uses the embedded LangWatch key

  @unit
  Scenario: A release build refuses a licence signed by the test key
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY names the committed test public key
    When a licence signed by the committed test private key is activated
    Then the licence is refused as having an invalid signature
    And the organization keeps its current plan

  @unit
  Scenario: A release build boots when the override is not a valid key
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY holds text that is not a PEM public key
    When the process boots
    Then it boots
    And licence verification uses the embedded LangWatch key

  @unit
  Scenario: A release build reports the embedded key in its usage report
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY names another public key
    When the usage report is taken
    Then it carries license_key_source "embedded"
    And it carries the fingerprint of the embedded LangWatch key

  # ============================================================================
  # The boot log
  # ============================================================================

  @unit
  Scenario: The boot log names the ignored override
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY names another public key
    When the process boots
    Then it logs once, at warning level, that LANGWATCH_LICENSE_PUBLIC_KEY is ignored on a release build
    And the log line does not contain the configured key

  @unit
  Scenario: A release build without the override logs nothing about it
    Given a release build
    And LANGWATCH_LICENSE_PUBLIC_KEY is unset
    When the process boots
    Then no line about LANGWATCH_LICENSE_PUBLIC_KEY is logged

  # ============================================================================
  # Development and test builds
  # ============================================================================

  @unit
  Scenario: A development build honours the public-key override
    Given a development build
    And LANGWATCH_LICENSE_PUBLIC_KEY names the committed test public key
    When a licence signed by the committed test private key is activated
    Then the licence is accepted

  @unit
  Scenario: A development build with the override refuses a licence signed by another key
    Given a development build
    And LANGWATCH_LICENSE_PUBLIC_KEY names the committed test public key
    When a licence signed by any other private key is activated
    Then the licence is refused as having an invalid signature

  @unit
  Scenario: A development build without the override verifies with the embedded key
    Given a development build
    And LANGWATCH_LICENSE_PUBLIC_KEY is unset or blank
    When a licence signed by the LangWatch production key is activated
    Then the licence is accepted
