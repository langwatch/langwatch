Feature: Automations list pages, providers, and shared copy

  The Overview/Automations/Reports pages
  (`pages/[project]/automations.tsx`) and two composer providers (dataset,
  annotation queue) carried a bundle of #6716 defects on top of the missing
  Overview create affordance (G5): deleting a row was immediate and
  irreversible, the copy for it named the wrong kind, row actions had no
  accessible name, and two provider panels had dead controls (dataset
  "+ Create New", the annotation-queue "Send to" listbox).

  The Alerts tab is gone: automations and alerts are one list, whatever they
  watch (ADR-093 §1). The two scenarios that pinned the "alert" delete noun
  and the three-item Overview create menu moved to
  `specs/automations/source-merge.feature`, which states the merged-world copy
  and carries their bindings.

  Background:
    Given a user viewing the Automations page for a project

  Rule: Deleting a row asks for confirmation and names its kind

    @integration
    Scenario: Confirming the dialog deletes the row everywhere it could reappear
      Given the delete confirmation dialog is open for an automation
      When the user confirms the deletion
      Then the automation is removed from the list
      And reopening the drawer can no longer show the deleted automation

    @integration
    Scenario: Deleting a report names it as a report, not an automation
      Given the Reports table has a row for an existing report
      When the user deletes it and confirms
      Then the toast reads "Report deleted"

    @integration
    Scenario: Cancelling the dialog leaves the row untouched
      Given the delete confirmation dialog is open for an automation
      When the user dismisses the dialog without confirming
      Then the automation is still present in the list

  Rule: Row actions expose an accessible name

    @integration
    Scenario: View, Edit, and Delete each have their own accessible name
      Given the Automations table has at least one row
      When the row's actions menu is opened
      Then the View, Edit, and Delete items each resolve by accessible role and name
      And the Delete item's accessible name includes the noun for what the row is

  Rule: A dataset can be created inline from the dataset action's panel

    @integration
    Scenario: Creating a dataset inline from a zero-dataset project
      Given a project with no datasets yet
      And the user is configuring an "add to dataset" automation
      When the user selects "+ Create New" in the dataset picker
      Then a create-dataset drawer opens
      And saving it selects the newly created dataset in the picker
      And no dataset had to exist beforehand

  Rule: The annotation-queue "Send to" selection is clickable everywhere it renders

    @integration
    Scenario: Selecting a queue from the automation composer's secondary drawer
      Given the user is configuring an "add to annotation queue" automation
      And the Configuration secondary drawer is stacked on top of the composer
      When the user opens the "Send to" combobox and picks a queue
      Then the queue is added to the selection
      And no duplicate, unresponsive listbox is left behind

  Rule: The automation view names its actual Slack destination

    An extra grant onto WS-6 (WS-3, the view drawer's own workstream, had
    not started): `ViewAutomationDrawer.tsx` labelled every Slack automation
    "Slack webhook", including bot-token deliveries that never carry a
    webhook at all, so the drawer could not answer "where does this post?"
    (#6244; stale PR #6245 tried and could not land, superseded here).

    @integration
    Scenario: The automation view names its Slack destination
      Given a Slack automation delivered by a connected Slack app bot
      And the automation has a destination channel chosen
      When the user views the automation
      Then the drawer names the delivery as the Slack app
      And shows the destination channel

    @integration
    Scenario: The delivery cell names a bot-delivery Slack automation
      Given the Automations table has a bot-delivery Slack automation row
      When the table renders
      Then the Delivery cell names the Slack app and its destination channel
      And it does not read as "Webhook"

  Rule: Estimated tokens is a qualifier on tokens, not a second field

    @unit
    Scenario: The search bar offers tokens as one concept
      Given the traces search bar's field suggestions
      When the user searches the field list
      Then "tokensEstimated" is never offered as its own field
      And searching "estimated" surfaces "tokens" instead

  Rule: A condition that can never match, or matches everything, says so

    A stored structured filter on a keyed field (`metadata.value`,
    `evaluations.passed`) selects by a key. Stored as a bare list it names no
    key, so it can never match; stored nested it must still say which key it
    reads. An automation with no condition at all acts on every trace.

    @unit @integration
    Scenario: A keyed filter chip names its key
      Given an automation whose filter is {"metadata.value": {"plan": ["true"]}}
      When its conditions render in the list or the drawer
      Then the chip reads "Metadata · plan" with the value "true"

    @unit @integration
    Scenario: A keyed filter stored without its key is flagged as never matching
      Given an automation whose filter is {"metadata.value": ["true"]}
      When its conditions render in the list or the drawer
      Then the chip is a warning reading "never matches: needs a metadata key"
      And its tooltip shows the nested shape the condition needed

    @integration
    Scenario: An automation with no condition is flagged as matching every trace
      Given a trace automation with no query, empty filters and no checks
      When it renders in the list or the drawer
      Then it is flagged "Matches every trace" in a warning tone
      And the drawer's history does not claim it only acts on matching traces

    @integration
    Scenario: The Delivery column never breaks an email address mid-word
      Given an email automation delivering to a long address
      When the Delivery cell is too narrow for it
      Then the address wraps after the "@" or before a "." and not mid-word
