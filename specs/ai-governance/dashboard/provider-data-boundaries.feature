Feature: Governance samples respect the connected source's data
  As a governance viewer
  I want sample fields to show what the connected source can supply
  So that a sample does not promise a measurement that needs another source

  @integration @regression
  Scenario: Copilot token gaps name the additional telemetry required
    Given a Copilot Dataverse catalog card without token telemetry
    When the card renders in real or sample mode
    Then tokens show a dash explaining that an additional telemetry source is required

  @integration @regression
  Scenario: Genie token gaps describe the conversation source
    Given a Genie catalog card without token counts
    When the card renders in real or sample mode
    Then tokens show a dash explaining that the conversation source does not report them

  @integration @regression
  Scenario: Licence samples require contract prices for money figures
    Given sample licence counts with no contract price
    When the catalog cards render
    Then monthly licence and unassigned licence costs show dashes requiring a contract price

  @integration @regression
  Scenario: Licence samples describe assignments rather than activity
    Given a Copilot sample with 120 of 200 licences assigned
    When its catalog card renders
    Then the seat count says assigned rather than active

  @integration @regression
  Scenario: Copilot agent samples with usage do not invent a dollar cost
    Given Copilot sample agents with conversation activity but no dollar cost calculation
    When their cards render
    Then cost shows a dash explaining that billing data and a supported calculation are required
    And their request counts remain visible

  @integration @regression
  Scenario: A measured zero remains a number
    Given a tool reporting zero tokens and an agent reporting zero dollars
    When their cards render
    Then both measurements remain visible as zero

  @unit @regression
  Scenario: An operator-only HTTP status never reaches a customer
    Given a listing outcome recorded with the provider's raw HTTP status
    When a customer-facing surface is built
    Then no customer-facing file names the status columns
    And the customer is shown the outcome and a sentence they can act on

  @unit @regression
  Scenario: The mirror carries no sensitive value onto a customer row
    Given a run status holding both HTTP statuses and the withheld person count
    When the ingestion source mirror is built from it
    Then none of the three values appear in the mirror
    And no mirror field carries one of them under another name

  @unit @regression
  Scenario: The erasure count never rides a span
    Given every command that exports a telemetry span
    When its span attributes are collected
    Then the attribute keys are exactly those declared for that command
    And the withheld person count is not among them

