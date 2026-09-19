Feature: Connect on a self-hosted install
  A self-hosted install with a connected license can use LangWatch-hosted
  services. Nothing is sent until an admin switches a service on, and the page
  where they do it states exactly what leaves the install for that service.

  As an admin of a self-hosted install
  I want to choose which hosted services my install may call, knowing what each one sends
  So that no data leaves my install without my decision

  Background:
    Given a self-hosted install with Connect enabled in its deployment configuration
    And an organization with a valid license that LangWatch has registered with "instant_evals" entitled

  # ============================================================================
  # Opt-in
  # ============================================================================

  @integration
  Scenario: Every hosted service starts switched off
    When an admin opens Settings, Connect for the first time
    Then "Instant Evals" is listed as available and switched off
    And no request has been sent to the hosted services host

  @integration
  Scenario: The page states what leaves the install before a service is switched on
    When an admin opens Settings, Connect
    Then the "Instant Evals" entry states that the judged text and the questions asked about it are sent to LangWatch
    And it states that they are not stored
    And it states that traces, prompts and datasets are never sent

  @integration
  Scenario: Switching a service on is an admin decision that is recorded
    When an admin switches "Instant Evals" on
    Then the service is on for the organization
    And the audit log records who switched it on and when

  @integration
  Scenario: A member who is not an admin cannot switch a service on
    When a member without organization management rights opens Settings, Connect
    Then they can see the status
    But they cannot switch a service on or change the cap

  @integration
  Scenario: The page marks a service the license does not include
    Given the license is not entitled to "instant_evals"
    When an admin opens Settings, Connect
    Then "Instant Evals" is shown as not included in the license
    And it cannot be switched on

  @integration
  Scenario: The page explains a deployment with Connect switched off
    Given a self-hosted install with Connect disabled in its deployment configuration
    When an admin opens Settings, Connect
    Then the page says Connect is switched off for this deployment
    And it says nothing is sent to LangWatch from this install

  @unit
  Scenario: Switching a service on leaves an audit record
    When an admin switches "Instant Evals" on
    Then the change is recorded in the audit log

  @unit
  Scenario: A service the license is not entitled to cannot be switched on
    Given the license is not entitled to "instant_evals"
    When an admin switches "Instant Evals" on
    Then the change is refused with code "connect_service_not_entitled"
    And the service stays switched off

  @unit
  Scenario: Connect disabled in the deployment configuration sends nothing
    Given a self-hosted install with Connect disabled in its deployment configuration
    When an admin reads the Connect settings
    Then the settings say that Connect is off for this deployment
    And no request is sent to either LangWatch host

  # ============================================================================
  # The classifier
  # ============================================================================

  @unit
  Scenario: An install with the service on judges through the hosted service
    Given "Instant Evals" is switched on
    When an eval function runs
    Then each judged text is sent to the hosted classify route with the license token and the instance id
    And the verdicts come back in the shape every other classifier returns

  @unit
  Scenario: An install with its own judge key keeps using it
    Given the install has its own judge key configured
    Then eval functions are judged with that key
    And nothing is sent to the hosted services host

  @unit
  Scenario: An install with the service off publishes eval functions as unavailable
    Given "Instant Evals" is switched off
    And the install has no judge key of its own
    Then eval functions are published as unavailable
    And nothing is sent to the hosted services host

  @unit
  Scenario: An install that sets nothing new keeps the classifier it had
    Given an install with no Connect configuration
    And the install has no judge key of its own
    Then the deployment judges with the classifier for an install that has no judge key
    And no request is sent to either LangWatch host

  @unit
  Scenario: Switching the service on takes effect without a restart
    Given eval functions are published as unavailable
    When an admin switches "Instant Evals" on
    Then the next eval function is judged through the hosted service

  @unit
  Scenario: Hosted calls go through the configured outbound proxy
    Given the deployment sets an HTTPS proxy
    When an eval function is judged through the hosted service
    Then the request is sent through that proxy

  # ============================================================================
  # Spend and cap
  # ============================================================================

  @integration
  Scenario: The page shows spend, cap and remaining credit
    Given the hosted usage route reports 120 USD spent of a 1000 USD cap
    When an admin opens Settings, Connect
    Then the page shows 120 USD spent, a cap of 1000 USD and 880 USD remaining
    And it shows the period those figures cover

  @integration
  Scenario: The page says when spend cannot be read
    Given the hosted usage route cannot report spend
    When an admin opens Settings, Connect
    Then the page says spend is not available right now
    And it still shows the cap

  @integration
  Scenario: An admin changes the cap
    When an admin sets the cap to 400 USD
    Then the hosted budget route is asked for 400 USD
    And the page shows the new cap

  @integration
  Scenario: A cap above the contract maximum is shown on the field
    When an admin sets a cap above what the contract allows
    Then the field shows that the contract maximum is lower, with the maximum
    And the cap is unchanged

  @unit
  Scenario: The cap an admin sets is carried to the hosted budget route
    When an admin sets the cap to 400 USD
    Then the hosted budget route is asked for 400 USD
    And the cap it confirms is what the settings report

  @unit
  Scenario: A cap above the contract maximum is refused with the maximum
    When an admin sets a cap above what the contract allows
    Then the change fails with code "connect_budget_above_contract_maximum"
    And the error carries the maximum the contract allows

  @unit
  Scenario: Spend the hosted usage route reports is read into the settings
    Given the hosted usage route reports 120 USD spent of a 1000 USD cap
    When an admin reads the Connect settings
    Then the settings report 120 USD spent, a cap of 1000 USD and 880 USD remaining
    And they report the services the license includes

  # ============================================================================
  # Named failures
  # ============================================================================

  @unit
  Scenario: A spent budget surfaces as a named error
    Given the hosted service answers 402 because the budget is spent
    When an eval function runs
    Then it fails with code "connect_budget_exhausted"
    And the error names the cap and says an organization admin can raise it in Settings, Connect

  @unit
  Scenario: An unregistered license surfaces as a named error
    Given the hosted service refuses the license as not registered
    When an admin reads the Connect settings
    Then the settings report code "connect_license_not_registered" and reading them does not fail

  @unit
  Scenario: A revoked license surfaces as a named error
    Given the hosted service refuses the license as revoked
    When an eval function runs
    Then it fails with code "connect_license_revoked"

  @unit
  Scenario: A license bound to another instance surfaces as a named error
    Given the hosted service refuses the call as coming from the wrong instance
    When an admin reads the Connect settings
    Then the settings report code "connect_wrong_instance"

  @unit
  Scenario: A service that is not entitled surfaces as a named error
    Given the hosted service refuses the call because the service is not entitled
    When an eval function runs
    Then it fails with code "connect_service_not_entitled"

  @unit
  Scenario: An unreachable host surfaces as a named error
    Given the hosted services host cannot be reached
    When an eval function runs
    Then it fails with code "connect_unreachable"
    And the error names the host and port that must be allowed outbound

  @unit
  Scenario: A failure on the LangWatch side is not blamed on the customer
    Given the hosted service answers with a server error
    When an eval function runs
    Then the failure is reported as a problem on the LangWatch side
    And the install keeps working for everything that does not need the hosted service

  @unit
  Scenario: An install without a license cannot use Connect
    Given an organization with no license
    When an admin reads the Connect settings
    Then the settings say that Connect needs a license

  @integration
  Scenario: The page sends an organization with no license to the license page
    Given an organization with no license
    When an admin opens Settings, Connect
    Then the page says hosted services need a license
    And it links to the license page

  @integration
  Scenario: The page shows a refusal in place of the hosted services
    Given the hosted service refuses the license
    When an admin opens Settings, Connect
    Then the page says what the refusal means and what to do about it
