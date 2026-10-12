# The catalogue half of the plan story. specs/billing/* own what happens when a
# plan is charged for; this one owns where the numbers themselves are stated.

Feature: One catalogue states every plan fact
  As a platform maintainer
  I want every plan's identity, price, limits and gates stated once
  So that two parts of the product can no longer quote a customer different numbers

  Background:
    Given the @langwatch/plans catalogue

  Rule: The catalogue is total and well formed

    @unit
    Scenario: Every plan in the catalogue satisfies the plan schema
      Given each plan the catalogue lists
      When it is parsed against the plan schema
      Then it is accepted

    @unit
    Scenario: Every plan type resolves to a plan
      Given each plan type the catalogue names
      When the catalogue is asked for that plan
      Then it answers with the plan of that type

    @unit
    Scenario: Every limit carries the unit it is counted in
      Given each limit on each plan
      When the limit is read
      Then it names one of the catalogue's units

  Rule: The self-serve ladder is ordered by the metered volume it sells

    @unit
    Scenario: The tiered ladder rises in volume once disputed rungs are set aside
      Given the tiered ladder beneath the cloud baseline
      When the rungs subject to a volume dispute are set aside
      Then each remaining rung sells at least as much volume as the one below it

    @unit
    Scenario: An annual variant shares the rung of the plan it is the same plan as
      Given the annual variant of a tiered plan
      When the catalogue is asked which rung it sits on
      Then it answers with the monthly plan's rung

    @unit
    Scenario: The rung above a plan is the next one up by volume
      Given an organization on the lowest ladder rung that sells more volume than the one below
      When the catalogue is asked what is above it
      Then it answers with the next rung up

    @unit
    Scenario: An account-managed plan sits on no rung
      Given a plan a person sells
      When the catalogue is asked for its rung
      Then it has none

  Rule: Facts two sites still state differently are recorded, not resolved

    @unit
    Scenario: The catalogue lists exactly the disputes found in the census
      Given the disputes the catalogue records
      When they are listed
      Then they are exactly the four the census found

    @unit
    Scenario: Every dispute names the plans it lands on, and those plans name it back
      Given a dispute that lands on particular plans
      When each of those plans is read
      Then it records that dispute, and records no dispute that does not name it

    @unit
    Scenario: Each dispute records both the chosen value and the one it disagrees with
      Given each dispute the catalogue records
      When it is read
      Then it names the site of the value in force and the site of every alternative

  Rule: The storage enum and the catalogue name the same plans

    @unit
    Scenario: Every stored plan type is a Postgres plan type
      Given the PlanTypes enum in schema.prisma
      When it is compared with the plan types the catalogue stores
      Then the two sets are equal

    @unit
    Scenario: Every pricing model is a Postgres pricing model
      Given the PricingModel enum in schema.prisma
      When it is compared with the pricing models the catalogue names
      Then the two sets are equal

  Rule: The self-hosted baseline is readable without an enterprise licence

    @unit
    Scenario: A deployment with no licence resolves to an uncapped plan
      Given a self-hosted deployment and no licence
      When the baseline is resolved
      Then it is the open-source plan and none of its limits is a cap

    @unit
    Scenario: The catalogue ships under the open-source licence
      Given the package the catalogue lives in
      When its licence is read
      Then it is the licence the other shared packages carry, not the enterprise one

  Rule: A bespoke contract is an override, never a new plan

    @unit
    Scenario: An explicit value in the contract wins over the plan's tier
      Given a contract that settles a member ceiling
      When it is applied over a plan
      Then the resulting plan carries the contract's ceiling

    @unit
    Scenario: A gate the contract explicitly withholds stays withheld
      Given a contract that withholds a capability the tier grants
      When it is applied over that plan
      Then the resulting plan does not grant it

    @unit
    Scenario: A self-hosted contract may not lower a plan beneath the open-source baseline
      Given a self-hosted contract that states less volume than the open-source baseline
      When it is applied
      Then the resulting volume is the open-source baseline's

    @unit
    Scenario: A self-hosted contract's seat count binds
      Given a self-hosted contract that sells ten seats
      When it is applied
      Then the resulting plan allows ten members and not more

    @unit
    Scenario: An overridden plan is account-managed whatever it started as
      Given a contract over a self-serve plan
      When it is applied
      Then the resulting plan is account-managed
