Feature: Automations list pages, providers, and shared copy

  The Overview/Automations/Alerts/Schedules pages
  (`pages/[project]/automations.tsx`) and two composer providers (dataset,
  annotation queue) carried a bundle of #6716 defects on top of the missing
  Overview create affordance (G5): deleting a row was immediate and
  irreversible, the copy for it named the wrong kind, row actions had no
  accessible name, and two provider panels had dead controls (dataset
  "+ Create New", the annotation-queue "Send to" listbox).

  Background:
    Given a user viewing the Automations page for a project

  Rule: Deleting a row asks for confirmation and names its kind

    @integration
    Scenario: Deleting an alert asks for confirmation and names it as an alert
      Given the Alerts table has a row for an existing alert
      When the user opens its row actions and chooses Delete
      Then a confirmation dialog appears before anything is deleted
      And the dialog names the row "alert", not "automation"

    @integration
    Scenario: Confirming the dialog deletes the row and the drawer cache
      Given the delete confirmation dialog is open for an alert
      When the user confirms the deletion
      Then the alert is removed from the list
      And the toast reads "Alert deleted"
      And a stale copy of the row can no longer be read from the drawer cache

    @integration
    Scenario: Deleting a schedule names it as a schedule, not an automation
      Given the Schedules table has a row for an existing schedule
      When the user deletes it and confirms
      Then the toast reads "Schedule deleted"

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
      And the Delete item's accessible name includes the row's kind

  Rule: The Overview offers a way to create every kind

    @integration
    Scenario: The Overview offers creating an automation, alert, or schedule
      Given the user is on the Overview tab
      When the user opens the create menu
      Then it offers "New automation", "New alert", and "New schedule"
      And choosing one opens the automation composer pre-set to that kind

  Rule: A dataset can be created inline from the dataset action's panel

    @integration
    Scenario: Creating a dataset inline from a zero-dataset project
      Given a project with no datasets yet
      And the user is configuring an "add to dataset" automation
      When the user selects "+ Create New" in the dataset picker
      Then a create-dataset drawer opens
      And saving it selects the newly created dataset in the picker
      Without requiring any dataset to have existed beforehand

  Rule: The annotation-queue "Send to" selection is clickable everywhere it renders

    @integration
    Scenario: Selecting a queue from the automation composer's secondary drawer
      Given the user is configuring an "add to annotation queue" automation
      And the Configuration secondary drawer is stacked on top of the composer
      When the user opens the "Send to" combobox and picks a queue
      Then the queue is added to the selection
      And no duplicate, unresponsive listbox is left behind

  Rule: The toaster reads as a toast in both themes

    @unit
    Scenario: A toast without a close button is not shifted off-centre
      Given a toast created with no close action
      When it renders
      Then its content padding is symmetric, not reserved for an absent close button

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
    Scenario: The Notifies cell names a bot-delivery Slack automation
      Given the Automations table has a bot-delivery Slack automation row
      When the table renders
      Then the Notifies cell names the Slack app and its destination channel
      And it does not read as "Webhook"

  Rule: Estimated tokens is a qualifier on tokens, not a second field

    @unit
    Scenario: The search bar offers tokens as one concept
      Given the traces search bar's field suggestions
      When the user searches the field list
      Then "tokensEstimated" is never offered as its own field
      And searching "estimated" surfaces "tokens" instead
