Feature: A self-hosted install shows the notices LangWatch sends
  Cloud's reply to the daily usage report may carry notices beside the latest
  release. The install keeps them and shows them on Ops, Upgrades, so an
  operator learns about a new release or a vulnerability without watching our
  blog. A notice already fixed by the running release is not shown.

  @unit
  Scenario: The usage report keeps the notices cloud's reply names
    Given cloud answers a usage report naming two notices
    When the install sends its daily report
    Then both notices are kept for the status to read
    And a later reply naming none forgets them

  @unit
  Scenario: A malformed notice is dropped and the rest are kept
    Given cloud's reply names one well-formed notice and one with no title
    When the install reads the reply
    Then only the well-formed notice is kept
    And the latest release in the same reply is still kept

  @unit
  Scenario: A notice fixed in the running release or earlier is not shown
    Given a kept notice fixed in 3.4.2
    When the status of an image on 3.4.2 or newer is read
    Then the notice is not named
    And on an image on 3.4.0 it is named

  @unit
  Scenario: No notices are named when usage reporting is off
    Given cloud once named a notice and usage reporting is now switched off
    When the status is read
    Then no notices are named

  @unit
  Scenario: An operator can opt out of notices and keep the usage report
    Given DISABLE_LANGWATCH_NOTICES is set and cloud's reply names a notice
    When the install sends its daily report
    Then the report is sent
    And no notice is kept or named

  @integration
  Scenario: The Upgrades overview shows notices above everything else
    Given a kept security notice "Vulnerability in prompt sharing" fixed in 3.4.2 and an info notice
    When an operator on 3.4.0 opens Ops, Upgrades
    Then the security notice is shown first, marked "Security", with its body, "Fixed in 3.4.2" and its link
    And the info notice is shown after it
    And with no notices nothing extra is shown
