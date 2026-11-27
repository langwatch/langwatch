Feature: Platform ops functions
  Platform functions answer facts that span organizations or the deployment itself: which
  release each service runs, which upgrade steps fail and on which tenants, and which evaluators
  run across the platform. The org function org.retention reads one approved organization.
  Outputs carry ids, counts, states, codes and times only. ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists with a project "acme-support"

  @integration
  Scenario: releases.state answers the release each live service runs
    Given a redeemed "ops:read" session naming "releases.state"
    And two api processes and one worker process are serving on the roster
    When the agent calls "releases.state"
    Then it answers the installed release, the image release and commit, and the step counts
    And one service row per role and release with its process count, image tag and when it started
    And no process id or host

  @integration
  Scenario: releases.state answers only allowlisted settings
    Given a redeemed "ops:read" session naming "releases.state"
    And the Langy mirror project id is set
    When the agent calls "releases.state"
    Then the settings page holds "langy.mirror_project_id" as set, with its project id
    And no other setting is answered

  @integration
  Scenario: releases.state says when an allowlisted setting is not set
    Given a redeemed "ops:read" session naming "releases.state"
    And the Langy mirror project id is not set
    When the agent calls "releases.state"
    Then the setting "langy.mirror_project_id" reads as not set, with no value

  @unit
  Scenario: releases.state reads its service rows on, page by page
    Given a redeemed "ops:read" session naming "releases.state"
    And more serving roles than one page holds
    When the agent calls "releases.state" with a limit, then with the cursor it answered
    Then the second call answers the service rows the first one left out

  @unit
  Scenario: A service role or image tag that is not a plain word reads as other
    Given a roster row whose role or image tag holds spaces or slashes
    When the release state folds it
    Then the role or tag reads as "other"

  @integration
  Scenario: upgrade.step_failures answers failed steps and the tenants a step parked
    Given a redeemed "ops:read" session naming "upgrade.step_failures"
    And the blocking step "trace:backfill-costs" failed with an error naming a code
    And the tenant step "dataset:move-records" parked three tenants
    When the agent calls "upgrade.step_failures"
    Then "trace:backfill-costs" carries its state, attempt, error code and last attempt time
    And "dataset:move-records" carries three failed tenants and their ids
    And no error text or log line

  @integration
  Scenario: upgrade.step_failures narrows to one step
    Given a redeemed "ops:read" session naming "upgrade.step_failures"
    And two steps failed
    When the agent calls "upgrade.step_failures" for "dataset:move-records"
    Then it answers only "dataset:move-records"

  @unit
  Scenario: An upgrade error with no code reads as other
    Given step errors as free text, as a leading snake_case code, and as a target failure
    When they become error codes
    Then free text reads as "other", the leading code is kept, and a target failure reads as "targets_failed"

  @unit
  Scenario: The tenant ids of one step are capped
    Given a step that parked 30 tenants
    When it is answered
    Then failedTenants is 30 and at most 20 tenant ids are listed

  @integration
  Scenario: org.retention answers retention days and traces per month for each project
    Given a redeemed "org:metadata" session on ACME naming "org.retention"
    And "acme-support" keeps traces 30 days and stored traces in every month
    When the agent calls "org.retention"
    Then each project carries its retention days per category and its traces per month for 12 months
    And the oldest month that holds traces and its pending retention rewrites

  @integration
  Scenario: org.retention reads only the approved organization
    Given a redeemed "org:metadata" session on ACME naming "org.retention"
    When the agent calls "org.retention" with an organization or project field
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: evaluators.platform_usage answers runs and failures per evaluator type across the platform
    Given a redeemed "ops:read" session naming "evaluators.platform_usage"
    When the agent calls "evaluators.platform_usage" for the last 7 days
    Then each evaluator type carries its project count, runs, errors by code and skipped count
    And no organization name, error message or evaluator setting

  @integration
  Scenario: evaluators.platform_usage refuses a range over 31 days
    Given a redeemed "ops:read" session naming "evaluators.platform_usage"
    When the agent calls it with a range of 40 days
    Then it is refused 422 with "staff_function_bad_input"