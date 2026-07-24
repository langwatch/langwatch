@support @backend
Feature: Bug Reports Intake
  As the LangWatch team
  I want reports sent by customers' coding agents to land in one place and alert us
  So that we learn about broken flows, confusing docs, and agent struggles without asking customers to copy-paste sessions

  # --- intake endpoint ---

  @integration
  Scenario: A summary report is stored
    When a report arrives at the public reports endpoint with a title, a summary, and agent metadata
    Then a report record is stored with the title, summary, source, and agent metadata
    And the response returns the new report id

  @integration
  Scenario: A full session report is stored with its transcript
    When a report arrives with a session transcript attached
    Then the report record stores the transcript
    And the response returns the new report id

  @integration
  Scenario: Reports do not require authentication
    When a report arrives without any credentials
    Then it is accepted and stored

  @integration
  Scenario: Reports with a valid project API key are linked to the project
    When a report arrives with a valid project API key
    Then the stored report references that project

  @integration
  Scenario: Reports with an invalid API key are still accepted, unlinked
    When a report arrives with an invalid or expired API key
    Then it is accepted and stored without a project reference

  @integration
  Scenario: Submitted content is redacted again on the platform before storage
    When a report arrives carrying a raw API key in the title, summary, transcript, or metadata
    Then the stored report carries redaction markers in place of the key
    And the raw key is nowhere in storage

  @integration
  Scenario: Submissions are rate limited per client
    Given a client already submitted many reports within the window
    When another report arrives from the same client
    Then it is rejected with a rate-limit response

  @integration
  Scenario: Oversized payloads are rejected
    When a report arrives with a payload beyond the size limit
    Then it is rejected with a payload-too-large response

  @unit
  Scenario: Malformed submissions are rejected with validation errors
    When a report arrives without a title and without any summary or session content
    Then it is rejected with a validation error

  # --- team alerting ---

  @integration
  Scenario: The team is notified on Slack for each new report
    Given Slack notification credentials are configured
    When a new report is stored
    Then a Slack message is posted to the configured channel
    And the message shows the title, the agent, the report kind, and a summary excerpt
    And the message links to the report in the admin area

  @integration
  Scenario: Missing Slack configuration never blocks intake
    Given Slack notification credentials are not configured
    When a new report is stored
    Then no Slack message is attempted
    And the report is stored normally

  @integration
  Scenario: Slack failures never fail the report intake
    Given Slack notification credentials are configured but Slack is unavailable
    When a new report arrives
    Then the report is stored and the response is successful

  # --- admin area ---

  @integration
  Scenario: Admins see reports in the backoffice
    Given stored bug reports exist
    When a LangWatch admin opens the bug reports backoffice page
    Then they see a table of reports with date, source, agent, kind, title, and contact
    And they can open a report to read the full summary and session transcript

  @integration
  Scenario: Non-admins cannot access bug reports
    When a regular user requests the bug reports listing
    Then access is denied
