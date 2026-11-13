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

  @unit
  Scenario: The support bag holds no prompt or trigger write
    Given the staff-support permission bag
    Then it holds no prompt write, since a prompt write can deploy to production
    And it holds no trigger write, since a trigger sends trace content out
    And prompt text is content, not metadata

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
  Scenario: A metadata key cannot read run results or stored files
    Given a redeemed "org:metadata" key on ACME
    When the agent reads an experiment run's results or a stored file
    Then it is refused 403 with "staff_content_not_approved"

  @integration
  Scenario: A support key creates an evaluator and a dataset as LangWatch Support
    Given a redeemed "org:support" key on ACME approved with the spend tick
    When the agent creates an evaluator and a dataset
    Then both are created
    And ACME's audit log holds a "staffAccess.write" row for each, naming LangWatch Support, Olivia and the reason

  @integration
  Scenario: The change's own audit row names LangWatch Support and the approver
    Given a redeemed "org:support" key on ACME approved by Olivia with the spend tick
    When the agent creates a monitor
    Then the "monitors.create" audit row names LangWatch Support and the reason
    And its actor is Olivia, not the key

  @integration
  Scenario: A support key without the spend tick changes datasets only
    Given a redeemed "org:support" key on ACME approved without the spend tick
    When the agent writes a dataset and edits an evaluator
    Then the dataset write is admitted
    And the evaluator edit is refused 403 with "staff_spend_not_approved"

  @integration
  Scenario: A run route says whether it spends
    Given a route declared withoutAudit("run, not a change")
    When it declares neither spends() nor withoutSpend with a reason
    Then the declaration is refused where it is written

  @integration
  Scenario: A staff key fails closed on writes no bag names
    Given a redeemed "org:support" key on ACME approved without the spend tick
    When the agent calls a write route that asks no permission
    Then it is refused 403 with "staff_spend_not_approved"

  @integration
  Scenario: A staff key never removes or switches off a record
    Given a redeemed "org:support" key on ACME approved with the spend tick
    When the agent calls a route that asks for a confirmation, such as pausing an alert
    Then it is refused 403 with "staff_write_not_allowed"

  @integration
  Scenario: The customer's log tells reads from writes by the route's declared kind
    Given a redeemed "org:support" key on ACME approved with the spend tick
    When the agent runs an LWQL query and then completes an onboarding step
    Then only the onboarding step writes a "staffAccess.write" row

  @unit
  Scenario: A staff key without the spend tick cannot run LWQL eval functions
    Given a redeemed key on ACME approved without the spend tick
    When the agent runs an LWQL query that calls eval()
    Then the eval functions are off for that query

  @integration
  Scenario: A staff key never reaches the public health probes
    Given a redeemed staff key on ACME
    When the agent calls the scenarios, triggers, workflows or evaluations health probe
    Then each answers 401 as for no key, and no run starts

  @unit
  Scenario: A staff key that names no project is told no project names
    Given a redeemed staff key on ACME
    When the agent calls a project route without "X-Project-Id"
    Then it is refused with "project_required" and an empty project list

  @integration
  Scenario: Refused staff calls leave a trail row
    Given a redeemed "org:content" key on ACME
    When it is refused for its address, or by a route's permission before the gate
    Then each refusal wrote a trail row with its status and error code

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
