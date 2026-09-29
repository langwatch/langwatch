Feature: One automation flow with a subject choice

  Automation and alert merge into one flow. An automation watches something
  — a trace filter, or a graph — applies a rule, and delivers. There is no
  type card and no source card: the wizard opens by asking what to watch,
  and the rule shape follows the answer. Reports — the renamed third
  concept, formerly "Schedule"; a report sends on a schedule, which is
  its description, not its name — stay separate with their own tab and
  entry point. The wizard is three steps — Watch,
  Delivery, Review — linear to create, opening on the review overview to
  edit. Slack delivers through named connections, organization- or
  project-scoped, as slack-connections.feature specifies. On the wire, "source" survives as a
  derived alias beside the unchanged kind discriminator; no screen shows
  the word.

  See dev/docs/adr/093-automations-source-merge.md.

  Background:
    Given a user in a project

  Rule: One flow, one opening question

    The former Alert is an automation that watches a graph. The wizard's
    first step is the subject itself: a trace filter or a graph, with the
    subject configured inline. What a saved automation watches never
    changes, because the graph slot and the report calendar make the
    conversion a create plus a delete.

    @integration
    Scenario: The wizard opens by asking what to watch
      When the user starts creating an automation
      Then the first step asks what the automation should watch
      And it offers a trace filter and a graph
      And no type or source picker is shown

    @integration
    Scenario: Creating an automation that watches a trace filter
      When the user chooses to watch a trace filter
      And sets a condition, a delivery channel, and a name
      Then the review step shows what it watches, the rule, the delivery, and the name together
      And saving creates one automation that acts on matching traces

    @integration
    Scenario: Creating an automation that watches a graph
      When the user chooses to watch a graph
      And picks a graph, a series, and a threshold rule
      And sets a delivery channel and a name
      Then saving creates one automation that fires when the metric crosses the threshold

    # The name lives on the review step, but a check on the last step reads as
    # "ready to save", so a name alone must not tick it while what to watch or
    # where to deliver is still open.
    @unit
    Scenario: The review step is only marked answered once the earlier steps are
      Given the user has named the automation
      When what it watches or where it delivers is still unanswered
      Then the review step is not marked as answered

    # Absorbs the untagged authoring-drawer.feature scenario "A completed
    # section collapses to a one-line summary" (reopen-any-section), which
    # is deleted when R0 lands.
    @integration
    Scenario: The wizard keeps completed steps in view
      Given the user has completed the watch step
      When the user is on the delivery step
      Then the completed step shows a one-line summary
      And the user can reopen any completed step to change it
      And returning to a completed step does not lose later answers

    # Consolidates the bound authoring-drawer.feature scenario "A project
    # with no custom graphs offers to create one": the draft-preservation
    # clause (new tab, draft not lost) carries over, and the merged flow
    # adds the template affordance.
    #
    # R0 ships the first two clauses inside the Watch step, and that half
    # stays bound where it already is — the authoring-drawer scenario keeps
    # its binding until F5 adds the template that ships its own graph, which
    # is the clause this scenario is waiting on. Consolidating earlier would
    # trade one bound scenario for one that cannot pass yet.
    @integration @unimplemented
    Scenario: Watching a graph with no graphs offers a way forward
      Given the project has no custom graphs
      When the user chooses to watch a graph
      Then the user sees an explanation instead of an empty graph picker
      And a link to create a custom graph that opens in a new tab so the draft is not lost
      And the step offers a template that ships with its own graph

    # The API half of this rule is already bound: public-api.feature's
    # "An automation cannot become an alert over the API" pins the refusal
    # and its code, and the ADR preserves both. Not restated here.
    @integration
    Scenario: What a saved automation watches cannot change
      Given a saved automation that watches a trace filter
      When the user edits it
      Then the filter-or-graph choice reads as locked with an explanation
      And the filter itself remains editable
      And the wizard offers creating a new automation to watch something else

  Rule: Editing opens on the overview, not on the watch step

    The lesson from the previous restructuring attempt: losing the overview
    while editing was the annoying part. Editing is hub-and-spoke — the
    review screen is home, and each section is edited alone.

    @integration
    Scenario: Editing an automation opens the review overview
      Given a saved automation
      When the user edits it
      Then the review overview opens with every section summarised

    @integration
    Scenario: Editing one section returns to the overview
      Given the user is editing a saved automation
      When the user opens the delivery section, changes the channel configuration, and finishes
      Then the review overview is shown again
      And the other sections are unchanged

  Rule: Closing the wizard without saving persists nothing

    Supersedes the untagged authoring-drawer.feature scenario "Abandoning
    the drawer persists nothing", which is deleted when R0 lands.

    @integration
    Scenario: Abandoning a create persists nothing
      Given the user has partially configured a new automation
      When the user closes the wizard without saving
      Then no automation is created

    @integration
    Scenario: Abandoning an edit persists nothing
      Given the user is editing a saved automation
      When the user closes the wizard without saving
      Then the stored automation is unchanged

  Rule: Advice that needs every facet renders where every facet is known

    The action-conditional ceiling advice, specified in
    automation-authoring-cap-advice.feature, reads the condition estimate
    and the drafted action class at
    once. The wizard separates those steps, so the advice renders at the
    first moment both are known: the review step at create, and the watch
    step when re-entered on edit, where the saved delivery already supplies
    the action class. The advice's own rules are unchanged and stay bound
    in their own file; these scenarios pin only the new seats.

    @integration
    Scenario: The ceiling advice renders on the review step at create
      Given the user drafted a persist action whose condition is over the plan's ceiling
      When the user reaches the review step
      Then the daily-limit advice is shown with its numbers

    @integration
    Scenario: The ceiling advice renders in the watch step on edit
      Given a saved over-ceiling automation with a persist action
      When the user edits it and opens the watch step
      Then the daily-limit advice is shown with its numbers

  Rule: One list for automations, whatever they watch

    Automations and alerts were two near-identical tables. They become one
    table whose columns say what each row watches and where it delivers.
    Reports keep their own tab, under their renamed noun.

    @integration
    Scenario: The unified table lists automations watching filters and graphs together
      Given the project has an automation watching a trace filter and one watching a graph
      When the user opens the automations list
      Then both appear in one table
      And each row shows what it watches and where it delivers

    @integration @unimplemented
    Scenario: Filtering the list to graph-watching automations
      Given the project has automations watching filters and graphs
      When the user filters the list to graph
      Then only graph-watching automations are shown

    @integration
    Scenario: Reports stay on their own tab
      Given the project has a report
      When the user opens the automations list
      Then the report is not in the automations table
      And the tab named "Reports" lists it

    # Inverts the bound list-pages.feature delete-noun scenarios (in flight
    # via #6884), which asserted the dialog and toast say "alert". R0 removed
    # them: this scenario carries the merged-world copy and its binding.
    @integration
    Scenario: Deleting names the row an automation, whatever it watches
      Given the unified table has a row that watches a graph
      When the user deletes it and confirms
      Then the confirmation dialog and the toast name it an automation
      And deleting a report names it a report

    # Supersedes list-pages.feature's "The Overview offers creating an
    # automation, alert, or schedule" (in flight via #6884), which R0 removed
    # along with the third menu item it asserted.
    @integration
    Scenario: The Overview offers creating an automation or a report
      Given the user is on the Overview tab
      When the user opens the create menu
      Then it offers "New automation" and "New report"
      And "New alert" is not offered

  Rule: A use-case template ships with its graph

    Picking a template must save work: a graph-watching template carries a
    graph specification and creates the graph with the automation. It
    always creates a new graph — a graph can back only one automation, so
    reusing one the user already has an automation on would be refused.

    @integration @unimplemented
    Scenario: A graph-watching template creates its graph
      When the user picks the error spike template and saves the automation
      Then a new graph backing the automation is created
      And the automation's rule watches that graph

    @integration @unimplemented
    Scenario: A refused template save leaves no orphan graph
      Given the user picked a template that ships a graph
      When saving the automation is refused
      Then no graph was left behind

  Rule: Old kind-based API clients keep working

    The wire keeps kind as the discriminator; source is a derived alias
    published beside it, and it is wire vocabulary only — no screen shows
    the word. Neither field is scheduled for removal.

    @integration @unimplemented
    Scenario: Creating with the kind field still works
      When an API client creates an automation using only the kind field
      Then the automation is created
      And the response carries both the kind and the matching source

    @integration @unimplemented
    Scenario: Creating with the source field works
      When an API client creates an automation using only the source field
      Then the automation is created
      And the response carries both the source and the matching kind

    @integration @unimplemented
    Scenario: A mismatched kind and source pair is refused
      When an API client sends a kind and a source that disagree
      Then the request is refused with the machine-readable mismatch code
      And the response names both values it received
