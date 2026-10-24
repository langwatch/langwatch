Feature: Per-credential read and export rate limits
  As an operator running LangWatch
  I want every read and export to count against the credential that made it
  So that no single API key, personal access token, session or staff account
  can download a tenant's data in bulk without the platform noticing and stopping it

  # The read budget sits in the API framework, after the door has resolved the
  # caller and before the handler runs. It counts per credential, not per
  # project: two keys on one project have two budgets, and one key cannot hide
  # behind a busy project. A credential is one of:
  #
  #   api_key            a project or organization API key, by key id
  #   access_token       a CLI personal access token, by its person
  #   legacy_project_key the project's legacy key, by project
  #   ingestion_key      an ingestion template key, by key id
  #   langy_session_key  a Langy session key, by key id
  #   session            a signed-in browser session, by person
  #   impersonation      a platform operator acting as somebody, by the operator
  #
  # Two dimensions are counted: requests per minute, and rows returned per hour
  # and per day. An export counts against a tighter allowance of its own,
  # exports per minute and per day. An operator acting as somebody else counts
  # against a separate, low allowance, keyed by the operator and not by the
  # person they act as, and every read they make leaves an audit log line.
  #
  # The allowances live in the request-bounds registry, so they scale with the
  # plan tier, `LANGWATCH_REQUEST_BOUNDS` changes them for the deployment and
  # `LANGWATCH_REQUEST_BOUNDS_BY_ORGANIZATION` raises them for one organization.
  #
  # Enforcement is behind `release_read_rate_limits_enforced`, off by default.
  # Off, a call past its allowance is still counted and still logged, and it is
  # answered as usual. On, it is refused.
  #
  # Every exceeded allowance logs one `read_rate_limit_exceeded` event with
  # these fields, which the security alerting reads:
  #   event, credentialId, credentialType, impersonatorId, route, kind,
  #   dimension, limit, observed, windowSeconds, retryAfterSeconds, enforced,
  #   projectId, organizationId

  Background:
    Given the read budget counts in a shared store every replica sees

  Rule: Reads count per credential

    @unit
    Scenario: A read under its allowance is answered
      Given an API key that has made fewer reads this minute than its allowance
      When it makes another read
      Then the read is admitted
      And nothing is logged

    @unit
    Scenario: Two keys on one project have separate budgets
      Given one API key on a project has used its whole minute's allowance
      When a second API key on the same project makes a read
      Then the second key's read is admitted

    @unit
    Scenario: A read past the minute's allowance is refused when enforcement is on
      Given enforcement is on
      And an API key has used its whole minute's allowance
      When it makes another read
      Then the read is refused with a read_rate_limited error
      And the refusal says how many seconds to wait
      And a read_rate_limit_exceeded event is logged with the key id, the key type, the route and the volume

    @unit
    Scenario: A read past its allowance is only logged while enforcement is off
      Given enforcement is off
      And an API key has used its whole minute's allowance
      When it makes another read
      Then the read is admitted
      And a read_rate_limit_exceeded event is logged marked as not enforced

  Rule: Rows returned count against an hourly and a daily allowance

    @unit
    Scenario: Rows returned are added to the credential's hourly and daily totals
      Given a session that has read no rows yet
      When a read answers with 500 rows
      Then 500 rows are counted against that session's hour and day

    @unit
    Scenario: A credential past its hourly row allowance is refused before the next read runs
      Given enforcement is on
      And a session has read more rows this hour than its hourly allowance
      When it makes another read
      Then the read is refused with a read_rate_limited error
      And the event names the rows-per-hour dimension

  Rule: Exports have a tighter allowance of their own

    @unit
    Scenario: An export counts against the export allowance, not the read allowance
      Given enforcement is on
      And an API key has used its whole minute's export allowance
      When it starts another export
      Then the export is refused with a read_rate_limited error
      And the event names the exports-per-minute dimension

  Rule: An operator acting as somebody has a low ceiling and leaves a trail

    @unit
    Scenario: A read made while impersonating counts against the operator
      Given a platform operator acting as a customer
      When the operator makes a read
      Then the read counts against the operator's impersonation allowance
      And not against the customer's own session allowance
      And an impersonated_read audit line names the operator, the person and the route

    @unit
    Scenario: An operator past the impersonation ceiling is refused when enforcement is on
      Given enforcement is on
      And a platform operator acting as a customer has used the impersonation allowance for the minute
      When the operator makes another read
      Then the read is refused with a read_rate_limited error
      And the event names the credential type impersonation

  Rule: Allowances are configurable

    @unit
    Scenario: An organization can be given a higher allowance than its plan
      Given an organization whose read allowance is raised for it alone
      When its allowance is resolved
      Then the raised allowance answers for that organization
      And every other organization keeps its plan's allowance

    @unit
    Scenario: A store failure never refuses a read
      Given the counting store is unreachable
      When a credential makes a read
      Then the read is admitted
      And the failure is logged

  Rule: A refusal tells the caller what to do

    @unit
    Scenario: The refusal carries a customer-safe message, the wait and the remediation
      When a read_rate_limited refusal is raised
      Then it is a 429 customer fault
      And its meta carries the retry-after in milliseconds and the dimension that ran out
      And it has remediation tips and presentation copy
