@governance @ingestion
Feature: Azure billing identity — the bill is read with its own credential

  Decision: ADR-128 §21 (v3.5)

  The Copilot Studio connection reads two very different things from
  Microsoft: employees' conversations, and money. Wave 1 read both with
  one registered app, which makes the finance grant and the
  employee-content grant the same signature. This feature splits them:
  the bill is read with a second credential that can read money and
  nothing else, stored inside the same connection.

  What this file deliberately does NOT restate (already owned elsewhere):
  the cost read being opt-in and never failing a run
  (copilot-studio-dataverse.feature), a failed read never rendering as
  zero (governance-cost-screen.feature), health staying green
  (ingestion-source-health.feature), and secrets never echoing to the
  browser (databricks-genie.feature and the generic secret-field tests).
  Those guards are generic; the scenarios here are only what a second
  identity adds.

  Background:
    Given a Copilot Studio source that reads a tenant's conversations
    And the tenant's spend is billed to an Azure subscription

  @unit
  Scenario: The bill is asked for with the billing credential, not the conversation one
    Given the source holds a billing credential beside the conversation one
    When the source reads the bill
    Then the sign-in for the bill presents the billing credential
    And the sign-in for the conversations presents the conversation one
    # The whole point of the split. Asserted on the captured sign-in
    # request bodies — which secret was presented for which audience —
    # not on configuration or logs.

  @unit
  Scenario: A source without a billing credential never borrows the conversation one
    Given the source names an Azure subscription
    But the source holds no billing credential
    When the source runs
    Then no request is made for the bill
    And the conversations are delivered as before
    # Distinct from "names no subscription reads no cost"
    # (copilot-studio-dataverse.feature): here everything needed for the
    # old single-credential read is present, and the read still must not
    # happen. A fallback to the conversation credential would silently
    # re-create the broad grant this feature exists to break, precisely
    # for the customer who declined to give billing access.

  @unit
  Scenario: A subscription cannot be saved without its own billing credential
    Given a save that names an Azure subscription
    And carries credentials for reading conversations
    But carries no billing credential
    When the admin saves the source
    Then the save is refused
    And the refusal says the bill needs its own sign-in
    # Refused at save time so the state "subscription named, bill
    # unreadable forever" cannot exist to need explaining on the spend
    # panel. Half a billing pair is refused the same way — one key of two
    # is not a sign-in. "A save" means every write that can put the claim
    # there: a create, and an edit that adds the claim while the stored
    # secrets ride across sealed. Leaving either open is enough to store
    # the state, which is why the spend panel carries no sentence for it.

  @unit
  Scenario: The billing credential is only ever presented to the sign-in service
    Given the source holds a billing credential
    When the source runs to completion
    Then the billing secret appears only in requests to Microsoft's sign-in host
    And no other request carries it
    # Every sibling credential pins its destination; a second credential
    # is a second thing postable to a typed-in host. The bearer tokens it
    # buys travel further — the secret itself does not.

  @unit
  Scenario: A tenant that declared prepaid packs is told the bill cannot show them
    Given the customer declared the tenant pays with prepaid message packs
    And the bill was read and contained nothing for conversations
    When the spend is shown
    Then the panel explains prepaid packs do not appear in the bill
    # Prepaid credit packs create no Azure resource, so the cost feed
    # returns nothing — byte-for-byte what a quiet pay-as-you-go month
    # returns. Only the customer's own declaration licenses this sentence.

  @unit
  Scenario: A tenant that declared nothing is never told it is prepaid
    Given the customer declared nothing about prepaid packs
    And the bill was read and contained nothing for conversations
    When the spend is shown
    Then the panel says nothing was billed for the period
    And the panel does not mention prepaid packs
    # The vacuity guard on the declaration axis: without it, printing the
    # prepaid sentence unconditionally would pass the scenario above.

  @unit
  Scenario: A declared-prepaid tenant whose bill has amounts sees the amounts
    Given the customer declared the tenant pays with prepaid message packs
    But the bill was read and contained amounts for conversations
    When the spend is shown
    Then the panel shows the billed amounts
    And the panel does not explain anything away as prepaid
    # The vacuity guard on the bill axis: the declaration explains an
    # empty bill, it never overrides a real one. A tenant can be both —
    # packs for one agent, pay-as-you-go for another.
