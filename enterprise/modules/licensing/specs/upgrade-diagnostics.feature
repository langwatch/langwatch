# A failed upgrade step's diagnostics, sent over Connect and kept 30 days on Cloud.
# Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md.
Feature: Upgrade diagnostics over Connect

  # The install end

  @unit
  Scenario: An install sends a bundle to the licence host with its licence credential
    Given an install whose licence carries a Connect credential
    When it sends the diagnostics of a failed step
    Then the licence host receives the submission with that licence token and instance id
    And the install answers the report id the host filed it under

  @unit
  Scenario: Sending is refused when Connect is switched off
    Given an install with Connect switched off
    When it sends the diagnostics of a failed step
    Then the send is refused as connect_disabled and nothing leaves the install

  @unit
  Scenario: Sending is refused when the install holds no licence
    Given an install with Connect permitted and no licence
    When it sends the diagnostics of a failed step
    Then the send is refused as upgrade_diagnostics_license_required

  @unit
  Scenario: An install tells whether sending is available and why not
    Given installs with Connect switched off, with no licence, and with a licence
    When each is asked whether upgrade diagnostics can be sent
    Then they answer connect_disabled, no_licence, and available

  @unit
  Scenario: Asking whether sending is available mints no instance id
    Given an install with a licence that has never minted an instance id
    When ops asks whether diagnostics can be sent
    Then the answer comes from the licence alone and no instance id is minted

  # The hosted end

  @unit
  Scenario: Cloud stores a received bundle and files a report row
    Given a verified licence caller
    When it records a diagnostics submission
    Then the bundle is written under upgrade-diagnostics/<instanceId>/<reportId>.json on the platform tenant
    And a report row names the step, release, attempt, trigger, size and a 30-day expiry

  @unit
  Scenario: Cloud refuses an install that sends too many bundles in a day
    Given an instance that already sent its daily allowance of bundles
    When it records one more
    Then the submission is refused as upgrade_diagnostics_rate_limited and nothing is stored

  @unit
  Scenario: The licence host refuses a body larger than the bundle cap
    Given the connect host's upgrade diagnostics route
    When a body larger than the bundle cap arrives
    Then the route refuses it before the handler runs

  @unit
  Scenario: The first report of a step and release posts one metadata-only Slack message
    Given an instance with no earlier report of a step on a release
    When it records a diagnostics submission
    Then one Slack message names the instance, the organisation, the release, the step, the attempt and the trigger
    And it links to the instance in Cloud admin
    And it carries no error text and no log lines

  @unit
  Scenario: A later report of the same step and release posts nothing more
    Given an instance that already announced a step on a release
    When it records another attempt of that step
    Then no Slack message is posted

  @unit
  Scenario: A failed Slack post does not fail the receipt
    Given a Slack channel that refuses every post
    When an instance records a diagnostics submission
    Then the install still receives its receipt

  # Cloud admin

  @unit
  Scenario: Cloud admin lists an instance's reports newest first
    Given an instance with two reports
    When Cloud admin lists its diagnostics
    Then both are answered, the newest first

  @unit
  Scenario: Cloud admin downloads a report through a five-minute link
    Given a stored report
    When Cloud admin asks to download it
    Then a signed link valid for five minutes is answered

  @unit
  Scenario: Downloading an unknown report is refused by name
    Given no report with the asked id
    When Cloud admin asks to download it
    Then the request is refused as upgrade_diagnostics_not_found

  @unit
  Scenario: A report past its 30 days is no longer listed or downloadable
    Given a report received more than 30 days ago
    When Cloud admin lists the instance's reports or asks to download it
    Then the list leaves it out and the download is refused as upgrade_diagnostics_not_found

  @unit
  Scenario: Listing and downloading diagnostics are both audited
    Given a Cloud admin staff member
    When they list an instance's diagnostics and download one
    Then both land on the audit log, and the download asks ops:manage

  @integration
  Scenario: The instance drawer lists the diagnostics and downloads one
    Given an instance with a received diagnostics report
    When Cloud admin opens its drawer
    Then the Diagnostics section lists the step, release, attempt, trigger, received and expiry
    And Download opens the signed link

  @integration
  Scenario: The self-hosted instances page opens the drawer from the link Slack carries
    Given the self-hosted instances page opened with ?instance=<row id>
    When it renders
    Then that instance's drawer is open
