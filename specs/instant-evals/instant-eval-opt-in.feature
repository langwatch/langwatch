Feature: An organization switches Instant Evals on itself, once it has read where the judged text goes

  As a member of an organization on the hosted service
  I want to switch Instant Evals on from the search bar, after being told where my trace text goes
  So that my organization agrees to that data flow itself, rather than having it turned on for it

  A run sends the judged text to the judge's provider under a data processing agreement,
  and the provider does not train on it. That is a flow an
  organization agrees to, so:
  - a self-serve organization is offered the switch in the popover, with the explanation and a
    link to the docs paragraph that says the same at length, to a member who may manage the
    organization; a member who may not reads the same explanation and is told to ask an
    organization admin, and is never offered a button the server would refuse;
  - an enterprise organization is offered a word with us instead, and is never switched on by a
    click;
  - a self-hosted install that judges through LangWatch is released by its license: the customer
    signed a license that names Instant Evals, which is the same agreement, and an organization
    admin can still switch hosted judging off in Settings, Connect;
  - a self-hosted install that is not released is told why in its own terms: its license does
    not include Instant Evals, an admin switched them off, it cannot reach LangWatch, or it
    judges with its own key and its operator decides;
  - the operator's release flag stays as it was, and the flag, the license or the switch makes a
    project judgeable.

  Rule: The offer depends on the plan, the deployment, and whether the member may throw the switch

    @unit
    Scenario: A self-serve organization is offered the switch
      Given an organization on the hosted service that is not on an enterprise plan
      And a member who may manage the organization
      When the popover asks what to offer
      Then it is offered the switch

    @unit @integration
    Scenario: A member who may not throw the switch is told to ask an admin
      Given an organization on the hosted service that is not on an enterprise plan
      And a member who may not manage the organization
      When the popover asks what to offer
      Then it is offered a word with an organization admin
      And the popover says where the judged text goes, links "Read more", and offers no "Enable"
      And no estimate is requested and the typed query stays in the bar

    @unit
    Scenario: An enterprise organization is offered a word with us
      Given an organization on the hosted service that is on an enterprise plan
      When the popover asks what to offer
      Then it is offered a word with us, whatever the member may do

  Rule: A self-hosted install is released by its license, and told why when it is not

    @unit
    Scenario: A license that names Instant Evals releases them without the flag
      Given a self-hosted install that judges through LangWatch, with the release flag off
      And the organization's license names Instant Evals and no admin switched them off
      When the project asks whether it may judge
      Then it may, from the license, and the organization's own switch is not read

    @unit
    Scenario: An admin who switched hosted judging off keeps it off
      Given a self-hosted install that judges through LangWatch, with the release flag off
      And the organization's license names Instant Evals but an admin switched them off
      When the project asks whether it may judge
      Then it may not

    @unit
    Scenario: An install with its own judge key still waits for the release flag
      Given a self-hosted install that judges with its own key, with the release flag off
      When the project asks whether it may judge
      Then the license is not what releases it

    @unit
    Scenario: A self-hosted install is told why from its judge and its license, and the plan is not read
      Given a self-hosted install
      When the popover asks what to offer
      Then an install whose license does not include Instant Evals, or that holds no license, is told its license does not include them
      And an install whose admin switched hosted judging off is told where to switch it back on
      And an install with Connect switched off, or that holds no credential to present, is told it cannot reach LangWatch
      And an install that judges with its own key, or with judging turned off, is told to ask whoever runs it

    @integration
    Scenario: Each self-hosted refusal says what to do about it
      Given an eval chip refused on a self-hosted install
      When the popover opens
      Then a license without Instant Evals offers to contact us to add them
      And a switched-off organization names Settings, Connect, and offers no "Contact us"
      And an install that cannot reach LangWatch names connect.langwatch.ai and gateway.langwatch.ai and links "Read more"
      And an install that judges with its own key offers no "Contact us"

    @integration
    Scenario: A judgement that fails on an install judging through LangWatch names the addresses it needs
      Given a project on an install that judges through LangWatch
      When the judge can't be reached for an eval chip
      Then the "can't run right now" popover names connect.langwatch.ai and gateway.langwatch.ai
      And it still offers to contact us

  Rule: The switch is the organization's, and the first click is the one that counts

    @integration
    Scenario: Instant Evals off for a self-serve organization open the enable popover
      Given an organization that has not switched Instant Evals on, offered the switch
      When the reader submits an eval chip
      Then a closable popover anchored under the search bar says where the judged text goes, under what agreement, and that it is never trained on
      And it offers "Enable" and a "Read more" link to the docs paragraph on where the judged text goes
      And no estimate is requested and the typed query stays in the bar
      And "Not now", Escape and a click outside keep the typed query and search nothing

    @integration
    Scenario: Enable switches the organization on and the judgement goes ahead
      Given the enable popover is open over a submitted eval chip
      When the reader clicks "Enable"
      Then the switch is thrown for the project's organization, resolved on the server and never taken from the client
      And the access read is refreshed
      And the popover closes and the same chip goes on to the estimate
      And a switch answered after a later submit superseded it starts nothing

    @unit
    Scenario: Enable records the moment and the member, once
      Given an organization that has not switched Instant Evals on
      When a member throws the switch
      Then the moment and the member are recorded
      And a later click leaves the first record in place

    @integration
    Scenario: A second click against the database keeps the first record
      Given an organization a member has switched Instant Evals on, stored in Postgres
      When another member throws the switch later
      Then the stored moment and member are still the first member's

    @integration
    Scenario: A refused switch is a warning and the popover stays
      Given the enable popover is open
      When the server refuses the switch
      Then the registry's words are shown as a warning
      And no estimate is requested and the popover stays open

    @unit
    Scenario: An organization that switched itself on is judged without the flag
      Given the release flag is off for the project and its organization switched Instant Evals on
      When the project asks whether it may judge
      Then it may, from the organization's switch
      And a project the flag is on for never reads the switch

  Rule: An enterprise organization is never switched on by a click

    @integration
    Scenario: Instant Evals off for an enterprise organization open the contact-us popover
      Given an organization that is offered a word with us
      When the reader submits an eval chip
      Then a closable popover anchored under the search bar says Instant Evals aren't enabled for this project and offers to contact us
      And no estimate is requested and the typed query stays in the bar
      And closing it, by Escape or a click outside, keeps the typed query and searches nothing

    @unit
    Scenario: The server refuses a switch the popover did not offer
      Given an organization that is offered a word with us
      When a request tries to throw the switch anyway
      Then it is refused as not offered, and nothing is recorded
      And the refusal says whether the plan or the self-hosted license is what says no
