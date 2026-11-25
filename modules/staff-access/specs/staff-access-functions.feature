Feature: Ops functions
  A staff session reads production through named, typed functions that answer ids, counts,
  states and times. The passkey signs the list of functions; an `org:metadata` session reaches
  nothing else. ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists with a project "acme-support"

  @unit
  Scenario: No function output names content or a secret
    Given every function in the registry
    Then no output field name reads as content, a message, a prompt, a key secret or a token
    And every input is strict, so an unknown field is refused

  @unit
  Scenario: No org function input names an organization
    Given every function with the "org" scope
    Then its input has no organization, project list or user field that could reach another organization

  @unit
  Scenario: Every list a function answers is a page
    Given every function whose output holds a list
    Then the output is items, total, truncated and nextCursor

  @unit
  Scenario: The passkey signs the list of functions
    Given a request for "org:metadata" on ACME naming "org.snapshot" and "org.api_keys"
    When the approval hash is computed with the functions in another order
    Then it is the same hash
    And a hash over a different list of functions differs

  @integration
  Scenario: A request names only functions that exist and fit its scopes
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:metadata" on ACME naming "org.nope"
    Then it is refused 422 with "staff_function_unknown"
    When the agent asks for "org:metadata" on ACME naming "orgs.find"
    Then it is refused 422 with "staff_function_scope_mismatch"
    When the agent asks for "org:metadata" on ACME naming no function
    Then it is refused with a validation error

  @integration
  Scenario: The approval page shows the functions it approves
    Given a pending request for "org:metadata" on ACME naming "org.snapshot"
    When Olivia opens the approval page
    Then it lists "org.snapshot" with its title

  @integration
  Scenario: A metadata session gets an ops token and no organization key
    Given an approved request for "org:metadata" on ACME naming "org.snapshot"
    When the agent redeems it
    Then it receives an ops token and no API key
    And no organization key was minted

  @integration
  Scenario: A metadata session calls only the functions its approval signed
    Given a redeemed "org:metadata" session on ACME naming "org.snapshot"
    When the agent calls "org.snapshot"
    Then it answers ACME's snapshot
    When the agent calls "org.api_keys"
    Then it is refused 403 with "staff_function_not_approved"
    When the agent calls "org.nope"
    Then it is refused 404 with "staff_function_unknown"

  @integration
  Scenario: Support mode still drives the whole CLI against its organization
    Given an approved request for "org:support" and "org:content" on ACME with the spend tick
    When the agent redeems it
    Then it receives an organization key that the gate admits on public routes
    And the function registry does not narrow it

  @integration
  Scenario: A function call writes its trail row with the function, its input and the rows read
    Given a redeemed "org:metadata" session on ACME naming "org.ingestion_health"
    When the agent calls "org.ingestion_health" for the last 7 days
    Then the trail row names "org.ingestion_health", holds the input and records how many rows it answered

  @integration
  Scenario: A function range is at most 31 days
    Given a redeemed "org:metadata" session on ACME naming "org.ingestion_health"
    When the agent calls it with a range of 40 days, or one that ends before it starts
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: A function's input is checked against its schema
    Given a redeemed "org:metadata" session on ACME naming "org.trace_presence"
    When the agent calls it with a field the function does not declare
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: The server lists the functions an agent may ask for
    Given Olivia enrolled "laptop agent"
    When the agent lists the functions with its requester key
    Then each has its name, title, scope, what it answers and its input schema

  @integration
  Scenario: Listing organizations answers a page and never cuts silently
    Given 60 organizations whose name holds "acme"
    And a redeemed "ops:read" session naming "orgs.find"
    When the agent finds organizations by "acme" with a limit of 50
    Then it gets 50 items, a total of 60, truncated true and a next cursor
    And the next cursor answers the remaining 10 with truncated false

  @integration
  Scenario: The usage answer names API keys by id and kind only
    Given a redeemed "ops:read" token
    When the agent asks the usage of ACME
    Then each API key carries its id and kind and no name

  @integration
  Scenario: org.snapshot answers plan, counts, creation and flags
    Given a redeemed "org:metadata" session on ACME naming "org.snapshot"
    When the agent calls "org.snapshot"
    Then it answers the plan, the members count, the project ids, when ACME was created and which flags are on
    And no member name or email

  @integration
  Scenario: org.ingestion_health answers trace counts per project and the last trace time
    Given ACME's project stored traces over the last days
    When the agent calls "org.ingestion_health" for the last 7 days
    Then each project carries its trace count, its last trace time and its plan-limit refusals

  @integration
  Scenario: org.trace_presence says whether a trace exists in a project of the organization
    Given a trace stored in "acme-support"
    When the agent asks for that trace id in "acme-support"
    Then it answers that it exists with its first and last time and its span count
    When the agent asks for a project outside ACME
    Then it is refused 404 with "staff_function_not_found"

  @integration
  Scenario: org.api_keys answers ids, kinds and times, never names or secrets
    Given ACME holds a project key and a personal access token
    When the agent calls "org.api_keys"
    Then each carries its id, kind, created and last used times and its scopes
    And none carries a name, a prefix or a hash

  @integration
  Scenario: org.usage_limits answers the plan's limits beside what the organization used
    When the agent calls "org.usage_limits"
    Then it answers each limit with its cap and the amount used

  @integration
  Scenario: org.evaluator_errors answers runs and failures per evaluator by code
    Given ACME's online evaluator ran and failed over the last days
    When the agent calls "org.evaluator_errors" for the last 7 days
    Then each evaluator carries its run count, its error count by code and its last error time
    And no error message

  @integration
  Scenario: queues.tenant answers the queue groups of one organization
    When the agent calls "queues.tenant"
    Then each queue carries ACME's pending, blocked and parked groups and its dead-letter count
    And no job payload

  @integration
  Scenario: user.sign_in answers one exact email and nothing about anyone else
    Given a redeemed "ops:read" session naming "user.sign_in"
    When the agent asks for "olivia@acme.test"
    Then it answers that the account exists, its last sign-in, its sign-in methods and whether it is locked
    When the agent asks for an email with no account
    Then it answers that no account exists, with nothing else
