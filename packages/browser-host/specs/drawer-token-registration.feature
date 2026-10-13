# Companion to specs/features/drawer-flow-callbacks.feature: how a drawer token keys the registry.
Feature: Drawer flow callbacks keyed by a drawer token

  A drawer is named by its owner's token, and on the wire by the token's name.
  A flow that registers callbacks under one may read them back under the other.

  @unit
  Scenario: A drawer token and its wire name are one registration
    Given a drawer named by its owner's token
    When a flow registers callbacks under the token
    Then they read back by the token and by the token's wire name alike
