Feature: The usage report the checkup previews
  The checkup screen shows a self-hosted customer the usage report their install
  would send. The deployment facts in it come from the modules that own them.

  @unit
  Scenario: The usage report says whether an AI Gateway is configured
    Given a self-hosted install
    When the usage report is previewed without a gateway address and then with one
    Then gateway_configured reads false and then true
