Feature: Using ops agent access
  A redeemed key reaches one organization for one hour, through the normal REST API and CLI.
  Every request leaves a trail row before its handler runs. ADR-202.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia approved access for her agent on the organization "ACME"

  @unit
  Scenario: The staff roles hold no credential, member, billing or delete permission
    Given the staff-reader and staff-support permission bags
    Then neither holds a secrets, virtual key, provider, SSO, member management, webhook or ops permission
    And neither holds any delete or manage permission
    And staff-reader holds no create or update permission

  @unit
  Scenario: Scopes map to permission bags
    Given the scopes "org:metadata", "org:content" and "org:support"
    Then metadata holds no trace read, content adds trace reads, and support adds the write bag

  @integration
  Scenario: A read key reads traces, analytics and LWQL in its organization
    Given a redeemed "org:content" key on ACME
    When the agent searches traces, asks an analytics timeseries and runs an LWQL query
    Then each answers 200
    And each wrote a trail row before the handler with the route, status and IP

  @integration
  Scenario: A key never reaches a second organization
    Given a redeemed "org:content" key on ACME and another organization "Globex"
    When the agent reads Globex's traces
    Then it is refused

  @integration
  Scenario: A metadata key cannot read trace content
    Given a redeemed "org:metadata" key on ACME
    When the agent searches traces
    Then it is refused

  @integration
  Scenario: A support key creates an evaluator and a prompt as LangWatch Support
    Given a redeemed "org:support" key on ACME
    When the agent creates an evaluator and a prompt
    Then both are created
    And ACME's audit log holds a "staffAccess.write" row for each, naming LangWatch Support, Olivia and the reason

  @unit
  Scenario: The change's own audit row names LangWatch Support and the approver
    Given a redeemed "org:support" key on ACME approved by Olivia
    When the agent creates a monitor
    Then the "monitors.create" audit row names LangWatch Support and the reason
    And its actor is Olivia, not the key

  @integration
  Scenario: A support key cannot touch members, API keys or secrets
    Given a redeemed "org:support" key on ACME
    When the agent lists or changes members, creates an API key or reads secrets
    Then each is refused

  @integration
  Scenario: A support key without the spend tick cannot start a run
    Given a redeemed "org:support" key on ACME approved without the spend tick
    When the agent starts a suite run
    Then it is refused 403 with "staff_spend_not_approved"

  @integration
  Scenario: The key is pinned to the address that redeemed it
    Given a key redeemed from one address
    When it is used from another address
    Then it is refused 403 with "staff_access_ip_mismatch"

  @integration
  Scenario: A key stops working after one hour
    Given a key redeemed more than one hour ago
    When the agent reads traces
    Then it is refused

  @integration
  Scenario: Revoking an undecided request means it can no longer be approved
    Given a pending request from Olivia's agent on ACME
    When Pedro revokes it
    Then Olivia's approval is refused as no longer pending
    And ACME's audit log holds no row for it

  @integration
  Scenario: Revoking a session that already ended is refused
    Given a session Olivia's agent already ended
    When Pedro revokes it
    Then he is refused with "staff_access_already_ended"

  @integration
  Scenario: Revoking a session whose hour ran out is refused
    Given a session whose hour ran out, before or after the sweep audited its end
    When Pedro revokes it
    Then he is refused with "staff_access_already_ended"
    And the customer's audit log holds only its "staffAccess.expired" end

  @integration
  Scenario: The kill switch also ends undecided requests
    Given a pending request from Olivia's agent on ACME
    When an operator revokes all agent access
    Then Olivia's approval is refused as no longer pending

  @integration
  Scenario: The kill switch revokes every live key
    Given two live sessions
    When an operator revokes all agent access
    Then both keys are refused on their next request
    And each organization's audit log holds a "staffAccess.revoked" row

  @integration
  Scenario: A key stops when its approver loses the operator grant
    Given Olivia's platform-operator grant is revoked
    When her agent's key is used
    Then it is refused 403 with "staff_access_operator_lost"

  @integration
  Scenario: A failed trail write refuses the request
    Given the trail store refuses writes
    When the agent reads traces
    Then it is refused 503 with "staff_access_audit_unavailable"
    And the handler did not run

  @integration
  Scenario: Natural expiry is audited
    Given a session whose hour passed with no revoke
    When the expiry sweep runs
    Then the organization's audit log holds one "staffAccess.expired" row for it
    And a second sweep writes none

  @integration
  Scenario: Ops read answers whether an organization still uses coding agents
    Given a redeemed "ops:read" token
    When the agent asks the usage of ACME
    Then it gets coding agent sessions for 7 and 30 days with the last session time, gateway spend and API key use
    And the answer explains how UI and API use are told apart
    And the call wrote a trail row

  @integration
  Scenario: Ops read is an allowlist
    Given a redeemed "ops:read" token
    When the agent calls an ops route that is not on the allowlist, such as the event log
    Then it is refused

  @integration
  Scenario: An organization key cannot call ops read routes
    Given a redeemed "org:content" key with no "ops:read" scope
    When the agent lists organizations
    Then it is refused
