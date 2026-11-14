Feature: Licence page actions and refusals
  The License page offers its actions only to people who may take them, takes a
  licence file by its content rather than its name, and names each refusal for
  what the operator can do about it. An install on an offline licence never
  calls LangWatch-hosted services from Settings, Connect or Checkup.

  # ============================================================================
  # Who sees the actions
  # ============================================================================

  @integration
  Scenario: A member without organization:manage sees no licence actions
    Given a member who may view the organization but not manage it
    When the member opens the License page of a licensed organization
    Then there is no "Remove license", "Replace license" or "Refresh license" button

  @integration
  Scenario: A member without organization:manage cannot activate a licence
    Given a member who may view the organization but not manage it
    When the member opens the License page of an unlicensed organization
    Then there is no "Activate license" button
    And the page says an organization admin can activate a licence

  @unit
  Scenario: The server still refuses licence changes from a member
    Given a member without organization:manage
    When the member calls upload, activate, remove or refresh directly
    Then each call is refused before the handler runs

  # ============================================================================
  # The licence file
  # ============================================================================

  @integration
  Scenario: A licence file renamed by a mail client is accepted by its content
    Given a licence file saved as "license.txt"
    When an admin drops it on the License page and activates it
    Then the licence key inside is sent for activation

  @integration
  Scenario: A file that holds no licence is refused with a reason
    Given a file whose content is not a licence key
    When an admin drops it on the License page
    Then the page says the file does not contain a LangWatch licence
    And nothing is sent for activation

  # ============================================================================
  # Refusals
  # ============================================================================

  @unit
  Scenario: A licence for another organization has its own refusal
    Given a genuine licence bound to another organization
    When an admin uploads it
    Then it is refused with the code license_organization_mismatch
    And a forged key is still refused with the code license_key_invalid

  # ============================================================================
  # Offline licences make no hosted call
  # ============================================================================

  @unit
  Scenario: Settings, Connect on an offline licence makes no hosted call
    Given an organization on a licence that names no hosted service
    When Settings, Connect or Checkup reads the hosted services status
    Then no call is made to the LangWatch gateway
    And the status says hosted services need a licence that includes them

  @unit
  Scenario: Connect disabled makes no hosted call
    Given LANGWATCH_CONNECT_DISABLED is true
    When Settings, Connect or Checkup reads the hosted services status
    Then no call is made to the LangWatch gateway
