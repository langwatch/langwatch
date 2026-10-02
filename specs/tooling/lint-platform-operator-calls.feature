@adr-137
Feature: The platform-operator-calls policy
  Granting and revoking platform operator accept a `system` caller that skips
  the ceiling and self-grant checks, so only ops and identity may call them
  (dev/docs/ARCHITECTURE.md §7, Platform operators are a grant). A call is a
  method named grantPlatformOperator or revokePlatformOperator in a file that
  imports `@langwatch/authz-contract`. Listing takes no caller and is open.

  Rule: `platform-operator-calls` refuses grant and revoke outside ops and identity

    Scenario: A module other than ops or identity calls an operation
      Given a file in the billing module imports the authz contract
      And it calls grantPlatformOperator
      When the platform-operator-calls policy reads the workspace
      Then it reports the file, the line and the operation

    Scenario: The ops module calls an operation
      Given a file in the ops module imports the authz contract
      And it calls grantPlatformOperator
      When the platform-operator-calls policy reads the workspace
      Then it reports nothing

    Scenario: The identity module calls an operation
      Given a file in the identity module imports the authz contract
      And it calls revokePlatformOperator
      When the platform-operator-calls policy reads the workspace
      Then it reports nothing

    Scenario: The authz module declares and serves the operations
      Given a file in the authz module calls grantPlatformOperator
      When the platform-operator-calls policy reads the workspace
      Then it reports nothing

    Scenario: Another module lists the platform operators
      Given a file in the billing module imports the authz contract
      And it calls listPlatformOperators
      When the platform-operator-calls policy reads the workspace
      Then it reports nothing

    Scenario: A file outside any module calls an operation
      Given an application file imports the authz contract
      And it calls revokePlatformOperator
      When the platform-operator-calls policy reads the workspace
      Then it reports the file, the line and the operation

    Scenario: A same-named method on something that is not AuthzApi is not a call
      Given a file calls grantPlatformOperator but never imports the authz contract
      When the platform-operator-calls policy reads the workspace
      Then it reports nothing
