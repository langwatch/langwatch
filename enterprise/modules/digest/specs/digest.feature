Feature: Weekly digest emails
  LangWatch Cloud sends each person one weekly email about their week's usage, picked from five
  templates by what their data shows. Operators choose the cohort and preview every email in Cloud
  admin before anything is sent. Anyone can unsubscribe in one click; clicks and unsubscribes are counted.
  Design: dev/docs/plans/weekly-digest.md

  # Picking a template

  @unit
  Scenario: An admin of an organization near its plan limit gets the plan-pressure email
    Given an organization at 85% of its monthly limit
    And a member who is an organization admin with 20 coding-agent sessions this week
    When the template is picked for that member
    Then it is digest-plan-pressure

  @unit
  Scenario: A member who is not an admin never gets the plan-pressure email
    Given an organization at 100% of its monthly limit
    And a member who is not an organization admin with 20 coding-agent sessions this week
    When the template is picked for that member
    Then it is digest-coding-agent-week

  @unit
  Scenario: A scenario failure rate that moved from its baseline picks the scenarios trend
    Given a project whose scenario failure rate was 10% on average over the last four weeks
    And 30% of its scenario runs failed this week
    When the template is picked for a member of that project
    Then it is digest-scenarios-trend and it says more are failing than usual

  @unit
  Scenario: A falling failure rate reads as getting better
    Given a project whose scenario failure rate was 30% on average over the last four weeks
    And 10% of its scenario runs failed this week
    When the template is picked for a member of that project
    Then it is digest-scenarios-trend and it says the runs are getting better

  @unit
  Scenario: A project with no scenario history has no trend
    Given a project with scenario runs this week and none in the four weeks before
    When the template is picked for a member of that project
    Then it is not digest-scenarios-trend

  @unit
  Scenario: A busy project picks the traces week
    Given a project with 12,000 traces this week and no coding-agent sessions
    When the template is picked for a member of that project
    Then it is digest-traces-week

  @unit
  Scenario: Low usage falls back to what's new
    Given a member with 40 traces and no coding-agent sessions this week
    When the template is picked for that member
    Then it is digest-whats-new

  # Folding the week

  @integration
  Scenario: Trace spans fold into the project's week as they arrive
    Given spans received for a project across two traces, one with an error
    When the digest subscriber has handled their events
    Then the project's week holds 2 traces, 1 error and the summed tokens and cost

  @integration
  Scenario: A burst of spans for one project drains as batched appends
    Given 500 spans received for one project within a second
    When the digest subscriber has handled them
    Then the project's week counts all 500 and fewer than 500 appends were made

  @integration
  Scenario: Coding-agent facts fold into the person's week
    Given coding-agent facts contributed for one user across three sessions
    When the digest subscriber has handled their events
    Then the user's week holds 3 sessions and the summed tokens, cost and lines

  @integration
  Scenario: Scenario outcomes fold into the project's week
    Given scenario runs that finished passing and failing this week
    When the digest subscriber has handled their events
    Then the project's week holds the passed and failed counts

  @integration
  Scenario: A redelivered event is not counted twice
    When the same evaluation completed event is delivered twice
    Then the project's week counts it once

  @integration
  Scenario: A fold holds numbers and ids, never personal data
    When any week is folded
    Then no fold row carries an email address or a name

  @integration
  Scenario: Weeks older than five are swept
    Given folds for the last seven ISO weeks
    When the weekly wake runs
    Then only the last five weeks remain

  # Sending

  @integration
  Scenario: Nothing is sent while the send is disarmed
    Given the week is built and the send is not armed
    When the scheduled wake runs
    Then no email is sent

  @integration
  Scenario: Each enrolled member gets one email a week
    Given the send is armed and an enrolled organization with three members
    When the scheduled wake runs twice
    Then each member receives exactly one email for this ISO week
    And every email carries an RFC 8058 one-click unsubscribe

  @integration
  Scenario: An unsubscribed member is skipped
    Given the send is armed and a member who unsubscribed
    When the week's emails are sent
    Then that member receives none

  @integration
  Scenario: A member of an organization unenrolled after planning is skipped
    Given the week's sends are planned for an enrolled organization
    When the organization is unenrolled before its sends are handled
    Then its members receive none

  @integration
  Scenario: Every link in a sent email is a tracked redirect
    When a digest email is sent
    Then every link in it points at /api/digest/c/ with a token
    And no token carries the target address

  # Unsubscribe and clicks

  @integration
  Scenario: One-click unsubscribe from the mail client
    When a POST with a valid unsubscribe token arrives
    Then the member is unsubscribed and the send it came from is recorded

  @integration
  Scenario: A forged or tampered unsubscribe token is refused
    When the unsubscribe page is asked with a token whose signature does not match
    Then the answer is refused as an invalid link
    And no subscription changes

  @integration
  Scenario: Resubscribing from the unsubscribe page
    Given a member who unsubscribed
    When they resubscribe from the same page
    Then they receive next week's email

  @integration
  Scenario: A tracked link records a click and redirects
    When a valid click token for a sent email's link is followed
    Then a click is recorded for that send and link
    And the answer redirects to the link's stored address

  @integration
  Scenario: A click token for an unknown link key never redirects
    When a click token names a link key its send does not hold
    Then the answer is not found and nothing redirects

  @integration
  Scenario: The unauthenticated routes are rate limited
    When one caller asks the unsubscribe or click route past the limit
    Then the caller is refused as too many requests

  # Cloud admin

  @integration
  Scenario: The digest admin is refused where cloud ops is off
    Given ops's cloud-ops capability is off
    When staff read the digest cohort
    Then the call is refused with not_found

  @integration
  Scenario: Only operators on the ops list read the digest admin
    Given a signed-in user who is not on the ops back-office list
    When they read the digest cohort
    Then the call is refused

  @integration
  Scenario: The gallery previews a person's email for every eligible template
    Given an organization's folds for last week
    When an operator previews a member's email
    Then every template the member is eligible for is rendered, with the picked one marked

  @integration
  Scenario: The cohort sorts by coding-agent cost
    Given three organizations with different coding-agent cost this week
    When the cohort is read sorted by coding-agent cost descending
    Then the organizations come back highest cost first

  @integration
  Scenario: Sending a test goes only to the operator
    When an operator sends themself a test of a member's email
    Then only the operator receives it
    And no DigestSend row is written

  @integration
  Scenario: Metrics count sends, unique clickers and unsubscribes by template and week
    Given ten sends of digest-traces-week this week, three members who clicked twice each and one unsubscribe
    When the metrics are read
    Then digest-traces-week shows 10 sent, 3 clickers, a 30% click rate and 1 unsubscribe

  @integration
  Scenario: The what's new card appears under the hero when published
    Given an update published for this week
    When any template is rendered
    Then the card sits under the hero with its title, body and link
