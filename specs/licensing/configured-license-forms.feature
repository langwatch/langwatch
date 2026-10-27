Feature: The configured license takes a signed license key or an activation code

  LANGWATCH_LICENSE_KEY (Helm app.license.key) takes either form, told apart
  by shape by one shared function that the License page also uses to route a
  value given under the other option. A signed license
  key is the long base64 string and works offline. An activation code is
  LW-XXXX-XXXX-XXXX-XXXX and is redeemed over HTTPS at connect.langwatch.ai for
  a signed license, which the install stores on its organization.

  Background:
    Given the platform is deployed in self-hosted mode

  @unit
  Scenario: an activation code and a signed license key are told apart by shape
    When a value is an activation code in any spelling a customer pastes
    Then it is read as an activation code
    When a value is a long base64 string
    Then it is read as a signed license key

  @unit
  Scenario: an activation code in the license variable is not read as a license
    Given LANGWATCH_LICENSE_KEY holds an activation code
    When the SSO gate checks the instance license
    Then the code is not parsed as a license
    And the organization licenses decide the gate

  @unit
  Scenario: an activation code in the license variable is redeemed at boot
    Given LANGWATCH_LICENSE_KEY holds an activation code
    And no organization holds a valid license
    When the app boots
    Then the code is redeemed with this install's instance id
    And the license is stored on the oldest organization
    And the log says it found an activation code and stored the license

  @unit
  Scenario: a boot after the code was redeemed does not redeem it again
    Given LANGWATCH_LICENSE_KEY holds an activation code
    And an organization already holds a valid license
    When the app boots
    Then nothing is sent to connect.langwatch.ai

  @unit
  Scenario: a refused redemption is logged with its reason and the app boots
    Given LANGWATCH_LICENSE_KEY holds an activation code
    And connect.langwatch.ai refuses it as already used by another install
    When the app boots
    Then the log names the refusal code
    And the boot continues without a license

  @unit
  Scenario: a replica that loses the redemption race reads the stored license
    Given two replicas of the same install boot with the same activation code
    And the other replica redeemed it and stored the license
    When this replica is told the code was already redeemed
    Then it reports the install as licensed rather than refused

  @unit
  Scenario: an activation code on a fresh install waits for the first organization
    Given LANGWATCH_LICENSE_KEY holds an activation code
    And no organization exists yet
    When the app boots
    Then nothing is sent to connect.langwatch.ai
    And the code is redeemed when the first organization is created

  @unit
  Scenario: an activation code with connect turned off is not redeemed
    Given LANGWATCH_LICENSE_KEY holds an activation code
    And LANGWATCH_CONNECT_DISABLED is set
    When the app boots
    Then the log says the code cannot be redeemed and to set the signed license key
