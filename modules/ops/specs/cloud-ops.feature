Feature: Cloud admin capability
  Cloud admin (subscriptions, licences, self-hosted instances, the bug-report inbox) is ops's
  own cloud-ops capability, from ops's config and secrets, never from isSaas (ARCHITECTURE.md section 3.5).

  @unit
  Scenario: Cloud admin is on only when asked for and the licence key matches the release
    Given LANGWATCH_CLOUD_OPS is not set
    Then Cloud admin is off whether or not a licence private key is held
    When LANGWATCH_CLOUD_OPS is true and the licence private key pairs with the release's public key
    Then Cloud admin is on

  @unit
  Scenario: Asking for Cloud admin without a matching licence key refuses boot
    Given LANGWATCH_CLOUD_OPS is true
    When no licence private key is held, or the key is not the pair of the release's public key
    Then ops refuses to boot with a message naming LANGWATCH_CLOUD_OPS and LANGWATCH_LICENSE_PRIVATE_KEY
    And the message never contains the key

  @unit
  Scenario: Cloud admin refuses as not found where the cloud-ops capability is off
    Given ops's cloud-ops capability is off
    When staff read the subscription admin surface or the bug-report inbox
    Then the call is refused with not_found

  @unit
  Scenario: The browser learns Cloud admin from what the ops process answered
    Given the ops process answered whether its cloud-ops capability is on
    When the ops slice of the public config is projected
    Then it carries that answer as cloudOps
