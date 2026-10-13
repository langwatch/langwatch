Feature: The API process authorizes through the installed authz module
  As an operator running a LangWatch API deployment
  I want a module that needs authorization to refuse to boot without the authz module
  So that every product route on the process can say no

  # The authz module owns the grant ledger, its pipeline and the permission
  # cache: it registers its pipeline itself and a process never hands it a
  # service. A module that checks a permission names AuthzApi as a peer, and a
  # process without the authz module refuses to boot, naming both (record
  # section 6). An authz module without the store it keeps state in refuses
  # by the store scenario in typed-process-supply.feature.

  Rule: a module that needs authorization is installed beside the authz module

    @unit
    Scenario: A process installing a module that needs authorization without the authz module refuses to boot
      Given a module that declares the authz module's Api as a peer
      When a process installs it without the authz module
      Then the boot refuses, naming the module and the authz peer
      And no product transport is mounted
