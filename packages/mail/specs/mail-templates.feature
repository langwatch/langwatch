Feature: The transactional messages LangWatch sends

  Every message a person receives from LangWatch is one registered template: a
  props schema, named fixtures, a subject line and a component. The registry is
  what the preview studio reads and what a person reads to find out what we
  actually send, so a template that is not in it does not exist as far as either
  is concerned.

  All of them are built in one shell, in the expressive design system — the
  marketing site's language, not the application's — because they are read
  outside the product by somebody who is usually not signed in.

  Background:
    Given the mail template registry

  @unit
  Scenario: A template that is not registered is caught
    Given a template component file under the templates folder
    When the registry is compared against the folder
    Then every template file is listed in the registry

  @unit
  Scenario: Every fixture renders an email
    When each template is rendered from each of its fixtures
    Then the rendering completes without failing

  @unit
  Scenario: Every rendered email carries a subject line
    When each template is rendered from each of its fixtures
    Then a non-empty subject line comes back with it

  @unit
  Scenario: Every link the props carry reaches the reader
    When each template is rendered from each of its fixtures
    Then every link address in the props appears in the rendered email

  @unit
  Scenario: Every rendered email has a plain text alternative
    When each template is rendered from each of its fixtures
    Then a non-empty plain text body comes back with it

  @unit
  Scenario: The rendered email is pinned, because the output is the product
    When each template is rendered from each of its fixtures
    Then the rendered email matches the stored snapshot

  @unit
  Scenario: Props that do not match the schema are refused
    Given props missing a field the template needs
    When the template is asked to render them
    Then it refuses rather than rendering an email with a gap in it

  @unit
  Scenario: Every email offers a dark colour scheme
    When each template is rendered from each of its fixtures
    Then the email declares that it supports both colour schemes
    And it carries a dark rule for every surface it paints

  @unit
  Scenario: Every email carries the LangWatch wordmark
    When each template is rendered from each of its fixtures
    Then the wordmark is present with the brand name as its alternative text

  @unit
  Scenario: No email is dressed in the application's design system
    When each template is rendered from each of its fixtures
    Then the application's own accent colour appears nowhere in it

  @unit
  Scenario: Only the wordmark for the reader's colour scheme draws
    When each template is rendered from each of its fixtures
    Then exactly one wordmark is drawn on the light ground
    And the cut for the other ground is hidden rather than faded

  @unit
  Scenario: The dark cut paints the page around the card, not only the card
    When each template is rendered from each of its fixtures
    Then the page around the card carries a dark rule of its own
    And the frame and the card read as one dark surface

  @unit
  Scenario: The studio shows every message at once
    When the gallery is asked to render every registered template
    Then it returns one entry for every registered fixture
    And every entry carries a non-empty subject line and a non-empty rendered body

  @unit
  Scenario: The studio's shareable link survives a copy-paste
    Given a person has edited a template's props in the studio
    When those props are encoded into the link's fragment
    Then decoding that fragment returns the same edited props

  @unit
  Scenario: A malformed shareable link falls back to the fixture
    Given a fragment that is not valid encoded props
    When the studio decodes it
    Then it falls back to the fixture's own props

  @unit
  Scenario: An added address's confirmation says what happened, and where to finish it
    Given somebody added a second email address to their own account
    When its confirmation email is sent
    Then it goes to that address, carrying the confirmation link
    And it says the address was added as a way to sign in, not that an account was created
    And it says to open the link in the browser the address was added from

  @unit
  Scenario: A changed two-step requirement tells each member who changed it and what it means
    Given an administrator turned an organization's two-step verification requirement on or off
    When a member is told
    Then the email goes to that member and names the organization and the administrator
    And it says whether a second factor is now needed to open that organization

  @unit
  Scenario: A platform operator change tells who changed whose role and links to the Operators page
    Given someone was given or lost the platform operator role
    When the notice is rendered
    Then it names the person, who made the change and the installation
    And a grant says to revoke the role on the Operators page if it was not expected
    And it links to the Operators page

  # A self-hosted operator cannot fix an upgrade step; LangWatch staff on Cloud can.
  # Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
  @unit
  Scenario: A self-hosted upgrade alert says what didn't finish in plain words
    Given two background upgrade steps failed on a self-hosted installation
    When the upgrade alert is rendered
    Then the subject says part of the upgrade didn't finish and names the installation
    And it counts the steps and says LangWatch keeps running
    And each step is named by what it does, with a link that opens that step
    And a step with a description shows no id, and no step shows error text or an attempt count

  @unit
  Scenario: A self-hosted upgrade alert for a failed blocking step does not say LangWatch keeps running
    Given a blocking upgrade step failed on a self-hosted installation
    When the upgrade alert is rendered
    Then it says LangWatch can't start serving the new version until the step finishes
    And it does not say LangWatch keeps running

  @unit
  Scenario: A self-hosted upgrade alert for mixed failures names only the blocking step as holding the new version
    Given a blocking and a background upgrade step failed on a self-hosted installation
    When the upgrade alert is rendered
    Then it says the new version waits on the step marked below
    And only the blocking step is marked as the one the new version waits on
    And it says the other step runs in the background

  @unit
  Scenario: A self-hosted upgrade alert says the details were already sent
    Given the hourly check already sent each failed step's diagnostics to LangWatch
    When the self-hosted upgrade alert is rendered
    Then it says LangWatch has the details and is looking into it
    And it does not ask the operator to send anything

  @unit
  Scenario: A self-hosted upgrade alert points at Send to LangWatch where Connect is available
    Given the installation can send diagnostics to LangWatch but did not send them by itself
    When the self-hosted upgrade alert is rendered
    Then it asks the operator to send the details from the step page

  @unit
  Scenario: A self-hosted upgrade alert falls back to the step id when a step has no description
    Given a failed upgrade step that declares no description
    When the self-hosted upgrade alert is rendered
    Then that step is named by its id

  @unit
  Scenario: A self-hosted upgrade alert offers a retry and a way to reach the LangWatch team
    Given an upgrade step failed on a self-hosted installation that cannot reach LangWatch
    When the upgrade alert is rendered
    Then it says the step can be retried from its page
    And it asks the operator to download the diagnostics and send them to support@langwatch.ai
    And it never asks the operator to fix the cause

  @unit
  Scenario: A self-hosted alert for a stopped runner asks for a running worker without internals
    Given the upgrade runner on a self-hosted installation stopped
    When the upgrade alert is rendered
    Then it asks the operator to check that a LangWatch worker is running
    And it names neither the lease nor the stopped process

  @unit
  Scenario: An upgrade alert on LangWatch Cloud shows each failed step with its id, error and own link
    Given two upgrade steps failed on LangWatch Cloud
    When the upgrade alert is rendered
    Then the subject counts the failed steps and names the installation
    And each step shows its id, its release, its attempt, its error and a link that opens that step
