Feature: The interactive process resolves a licensed deployment's plan

  Every allowance a customer sees on a screen is read off the plan their
  organization resolves to: the seats an administrator may fill, how far back
  captured trace content stays unteased, which features are switched on. A
  self-hosted deployment has exactly one paid source for that plan — the signed
  licence an administrator activated in Settings — and this process composed
  none, so a licensed install and an unlicensed one resolved the same plan.

  Nothing was capped by that, because the unlicensed baseline is uncapped. What
  was lost is the Enterprise tier the contract names: the seat count the
  customer bought did not bind, and the entitlements the tier carries were
  withheld from a customer who had paid for them.

  Background:
    Given an interactive process that opened its own database client

  @unit
  Scenario: A licensed self-hosted deployment resolves the plan its licence names
    Given an organization that activated a genuine Enterprise licence
    When their plan is resolved
    Then it is the plan the licence names, with the seats the licence sold
    And the message ceiling stays unlimited, because self-hosted volume is never
      metered
    And no missing licence source is reported, because this process composed one
    And on the hosted deployment the licence outranks the subscription, because
      a licence there is the negotiated contract

  @unit
  Scenario: An unlicensed self-hosted deployment stays unlimited
    Given an organization that activated no licence
    When their plan is resolved
    Then it is the unlimited baseline, with no member ceiling
    And a licence this deployment cannot verify resolves the same baseline,
      rather than a smaller plan than none at all
