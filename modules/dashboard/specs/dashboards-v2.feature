Feature: Dashboards v2 polish and bring-your-own-AI
  As a project member
  I want an empty board that offers one clear way to start, template cards that
  tell me what I will get, numbers that read correctly, a board that uses my
  screen, and fresh data
  And as a developer using my own AI agent, I want to add widgets to a board
  from Claude Code
  So that I can trust and use the board, and build boards without the UI

  # ---------------------------------------------------------------------------
  # UI polish
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC1 The empty board has no "Add a block" box
    Given the dashboards flag is on and a member opens a board with no widgets
    Then they see the Ask bar and "Start from a template" with the template cards
    And they do not see the "Add a block" box
    # Evidence: screenshot of an empty board

  @integration
  Scenario: AC10 A non-empty board still offers a way to add a widget
    Given a board with at least one widget
    Then the member can open the question picker from the board to add another widget
    # Evidence: screenshot of a board with widgets and its add control

  @e2e @unimplemented
  Scenario: AC2 Template cards say what the board shows
    Given a member opens a board with no widgets
    Then each question-group template card shows a summary of what the board shows
    And the summary comes from its own field, not the picker's "why" line
    And the summary is not cut off on a 1440px wide screen
    # Evidence: screenshot of the template cards

  @unit @unimplemented
  Scenario: AC3 A status tile without an earlier period says so
    Given the previous period has no traces and the current period has traces
    When the Status widget renders
    Then each tile shows "No earlier data" as its change label instead of "New"
    # Evidence: screenshot of the Status widget

  @unit @unimplemented
  Scenario: AC4 Money has cents
    Then a cost of 0 dollars shows as "$0.00"
    And a cost of 0.0042 dollars shows as "$0.0042"
    And a cost of 0.01 dollars shows as "$0.01"
    And a cost of 1.6 dollars shows as "$1.60"
    And a cost of 999.99 dollars shows as "$999.99"
    And a cost of 1000 dollars shows as "$1K"
    And a cost of 12345 dollars shows as "$12.3K"
    # Evidence: unit test of the formatter and a board screenshot showing a cost

  @e2e @unimplemented
  Scenario: AC5 The board uses a wide screen
    Given a 1440px wide window
    When a member opens a board
    Then the widget grid fills the content area beside the sidebar, less the page padding
    And the page has no horizontal scroll
    # Evidence: screenshot at 1440px

  @unit
  Scenario: AC6 Template tables are shorter than template charts
    When a member creates a board from any template
    Then every table widget is at most 4 grid rows high
    And no two widgets on the board overlap
    # Evidence: unit test over every template, and a board screenshot

  @e2e @unimplemented
  Scenario: AC7 The board shows data age and can refresh
    When a member opens a board with widgets
    Then the header shows when the data was last updated
    And a Refresh control reloads every widget and resets that time
    And the member can choose auto-refresh off, every minute, or every 5 minutes
    # Evidence: screenshot of the header with the time and the refresh menu

  @integration
  Scenario: AC19 One control sets the range, the grain and the refresh
    Given a member opens a board
    Then the header has one period control showing the range and grain, such as "30d · auto"
    And its menu has three columns: Range, Grain and Refresh, each with a check on the current choice
    And there is no separate auto-refresh control in the header
    # Evidence: screenshot of the open menu

  @unit
  Scenario: AC19b A grain that does not fit the range cannot be picked
    Given a board's range
    Then a grain is offered only when the range divided by that grain stays within the bucket budget
    And 1m is offered for Live, 1h and 24h only
    And 5m is listed but never offered, as LangWatchQL has no five-minute step
    And changing to a range the current grain does not fit sets the grain to auto
    # Decision: shown greyed out rather than hidden, as in the prototype

  @unit @integration
  Scenario: AC19c Live is the last hour, rolling, refreshed every minute
    When the member picks Live
    Then the board reads the last hour at auto grain, which is one-minute buckets
    And the control shows a green dot and "Live"
    And the board refreshes every minute and the window moves forward with each refresh
    And the other refresh choices are greyed out until the member picks another range
    # Decision: Live overrides the refresh choice without changing it; the member's own choice
    # applies again on any other range

  # ---------------------------------------------------------------------------
  # Bring-your-own-AI
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC8 An MCP agent adds a widget to a board
    Given an MCP client connected with a project API key
    When it calls add_dashboard_widget with a dashboard id, a name, widget code and named LWQL queries
    Then the widget is stored and placed on that dashboard
    And the tool returns the widget id
    And the widget shows on the board in the app
    # Evidence: the MCP call output and a screenshot of the board with the new widget

  @integration
  Scenario: AC8b add_dashboard_widget rejects an unknown dashboard
    Given an MCP client with a project API key
    When it calls add_dashboard_widget with a dashboard id that does not exist in the project
    Then the tool returns an error naming the dashboard id
    And no new widget is left in the project
    # Evidence: the MCP call output and the widget count before and after

  @unit @unimplemented
  Scenario: AC9 The docs explain how to build boards from an agent
    Then the Dashboards docs page has a section that lists the MCP dashboard tools, the widget definition format and the LW widget API
    # Evidence: the docs diff

  # ---------------------------------------------------------------------------
  # Question picker
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC12 A picked question adds its widget and seeds Langy
    Given a board with a widget on it, Langy enabled and the member may start a conversation
    When the member opens the picker and picks a question
    Then the picker closes
    And the question's widget is stored on the board below the existing widgets
    And Langy opens with the question's prompt ready to send and not sent
    And the open board is passed as context
    # Evidence: screenshot of the board with the new widget and Langy's drafted prompt

  @integration
  Scenario: AC12b Without Langy a picked question still adds its widget
    Given a board and Langy is not available to the member
    When the member opens the picker
    Then every question is still listed with no "Ask Langy" footer
    And picking one stores its widget on the board and opens no Langy conversation
    # Evidence: screenshot of the picker without Langy and the board with the new widget

  @integration
  Scenario: AC12c A failed add keeps the picker open and does not seed Langy
    Given a board with Langy enabled and the member may start a conversation
    When the member picks a question and the widget write is rejected
    Then the picker stays open
    And no widget is stored on the board
    And Langy opens no conversation
    # Evidence: the failed create call and the still-open picker

  # ---------------------------------------------------------------------------
  # Empty widgets
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC13 A quiet period does not ask the member to connect a source
    Given a template widget whose source sent data in the last 90 days
    And none of that data falls in the board's period
    Then the widget says there is nothing in this period, naming what it counts
    And it shows no setup button
    # Evidence: a connected project's widget over an empty period

  @unit
  Scenario: AC13b A source that was never set up shows its setup step
    Given a template widget whose source sent no data in the last 90 days
    Then the widget shows that source's setup step and the button to its setup page
    # Evidence: a new project's widget

  @unit
  Scenario: AC13c Every template widget checks its own source
    Then each template widget stores a query that asks whether its source sent data in the last 90 days
    And the widget runs that query only when its own queries return nothing

  @unit
  Scenario: AC14 Reviewer thumbs are named as reviewer thumbs
    Given a template widget that reads thumbs from the annotations table
    Then its name, summary, subtitle and labels say the thumbs come from reviewers in LangWatch
    And none of them call those thumbs feedback from users
    # Decision: the Flight Deck's "User feedback" title stays, as dashboards-v1 AC4 pins it;
    # its empty face no longer says the thumbs come from users

  # ---------------------------------------------------------------------------
  # The catalogue
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC15 Every widget answers a question from the question tree
    Given the dashboards catalogue
    Then every widget names the tree question it answers and the data it needs
    And every template lists only widgets from the catalogue, none of them twice

  @unit
  Scenario: AC15b A project's preloaded boards never repeat a widget
    Given an agent kind
    When its preloaded templates are resolved for that kind
    Then no widget appears on more than one of those boards

  @unit
  Scenario: AC15c The prototype's boards are the starter set, under the Agent Flight Deck name
    Given the dashboards catalogue
    Then the default template is named "Agent Flight Deck" and is preloaded for every application agent kind
    And coding agents get the six personal boards preloaded instead
    And the library's own templates are in the gallery only
    # Decision: the prototype's Cockpit cards replace the Flight Deck's widgets; the Flight Deck name stays

  @integration
  Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
    Given the picker is open on a board
    Then each branch of the question tree with a built widget is a section, in tree order
    And each section lists its built widgets by the question they answer
    And picking one stores it on the board under that question, as AC12 describes
    # Decision: a catalogue widget without code is listed as coming soon, and cannot be picked

  @unit @integration
  Scenario: AC17 Every widget and template is listed, coming soon until it is built
    Given the picker or the template gallery is open
    Then every catalogue widget is listed in the picker and every catalogue template in the gallery
    And a widget without code, or a template with any widget without code, says "Coming soon" and cannot be picked
    And a coming-soon template says how many of its widgets are built
    And the templates that can be made today come first

  @unit
  Scenario: AC18 Every widget and template carries a default Langy prompt
    Given the dashboards catalogue
    Then every widget has a prompt that asks its own question over the dashboard period
    And every template has a report prompt that asks each of its widgets' questions
    # Langy drafts the widget's prompt when it is picked (AC12); the template's report prompt is drafted on create next

  # ---------------------------------------------------------------------------
  # Flight Deck cockpit and Running costs widgets, from the prototype's cards
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC20 Flight Deck: This period sets four figures against the period before
    Given the "This period" widget on a board
    Then it shows the share of ended conversations that were resolved and the conversations
    And it shows the share of checks passing and the AI cost per resolved conversation
    And each figure shows its change from the equally long period before
    And checks leave out guardrails and the outcome judge
    And without outcomes the resolved figure says it is not measured and offers to add a judge

  @unit
  Scenario: AC21 Flight Deck: An outcome is the outcome judge's label or the outcome a trace sends
    Given a conversation whose last trace the "Conversation Outcome Judge" labelled
    And another whose last trace sends "outcome" in its metadata
    Then the cockpit and cost widgets count each conversation once, the sent outcome first
    And the outcome is dated by its trace, not by when the judge ran
    # Decision: the judge name is the dev seed's; a project's own judge needs the same name

  @unit
  Scenario: AC22 Flight Deck: Needs attention names the one problem to look at first
    Given the "Needs attention" widget on a board
    Then it names the customer or topic whose pass rate fell most, beyond noise
    And failing that, the failure reason that grew most
    And failing that, a judge whose verdicts drifted from the reviewers' thumbs
    And failing that, the step whose errors most often reach the user
    And it says "Nothing got worse in this period." when none of them holds

  @unit
  Scenario: AC23 Flight Deck: Top request it cannot serve names a topic, a count and an example
    Given conversations that ended as a capability gap in the period
    Then the widget names the topic with the most of them, how many, and one request with its trace

  @unit
  Scenario: AC24 Flight Deck: An outcome widget tells a quiet period from a missing judge
    Given an outcome widget with no outcomes in the board's period
    When the project sent an outcome in the last 90 days
    Then the widget says there were no outcomes in this period
    When it never did
    Then the widget says how to send outcomes and offers to add a judge

  @unit
  Scenario: AC25 Flight Deck: Resolved per day marks model and prompt changes
    Given the resolved-per-day widget on a board
    Then it draws the conversations resolved per bucket and their share of those that ended
    And it marks each model and prompt version first seen in the period on its bucket

  @unit
  Scenario: AC26 Flight Deck: Task success is the share of calls that got the job done, per language
    Given a voice agent's calls with an outcome
    Then the widget shows, per language from the trace metadata, the share that were resolved
    And calls without an outcome are left out

  @unit
  Scenario: AC27 Flight Deck: Accepted, edited or regenerated reads each output's action
    Given traces that send "output_action" in their metadata
    Then the widget shows per bucket the share accepted, edited, regenerated and ignored
    # Missing in LangWatch: a first-class output action event; the metadata key is the dev seed's

  @unit
  Scenario: AC28 Running costs: Spend shows the period, the cost per success and the month forecast
    Given the "Spend" widget on a board
    Then it shows trace and evaluator cost against the period before
    And it shows the cost per resolved conversation
    And it shows the month to date run on to month end at the last 7 days' pace
    # Missing in LangWatch: a project budget, so the prototype's budget figure is not shown

  @unit
  Scenario: AC29 Running costs: Production vs testing splits spend by where it came from
    Given the "Production vs testing" widget on a board
    Then it splits spend per bucket by trace origin into production, evaluations, simulations and experiments
    And evaluator runs count as evaluations
    And it says what share of the spend is test traffic

  @unit
  Scenario: AC30 Running costs: Wasted spend counts each production trace once
    Given the "Wasted spend" widget on a board
    Then a trace whose root span failed counts its whole cost as failed
    And a trace that called one tool three times or more counts its share of repeated spans
    And a trace that recovered counts each failed LLM call at its successful calls' price
    And the widget shows the total as a share of production spend

  @unit
  Scenario: AC31 Running costs: Cost per call shows speech as not priced
    Given the "Cost per call with speech vendors" widget on a board
    Then it shows the LLM cost per call from production traces
    And it shows speech as not priced, since LangWatch has no speech vendor rates

  @unit
  Scenario: AC32 Running costs: Cost per document is production cost per production trace
    Given the "Cost per document" widget on a board
    Then it shows the cost per document overall and per model, with model changes marked
    And it shows the second half of the period against the first, and the cheapest model

  # ---------------------------------------------------------------------------
  # Answer quality and What users ask widgets
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC40 Answer quality: How conversations ended reads the app's outcome first, then the judge
    Given the "How conversations ended" widget
    Then its queries take the outcome from the trace's "metadata.outcome" when the app sends one
    And otherwise from the label of the "Conversation Outcome Judge" evaluation on that trace
    And it charts the share of closed conversations misunderstood, not doable, refused and handed to a person per bucket
    And it lists the top 5 reasons with their share against the period before

  @unit
  Scenario: AC41 Answer quality: Unanswered, by topic is the refused share of closed conversations per topic
    Given the "Unanswered, by topic" widget
    Then it ranks topics by the share of their closed conversations with the outcome "refusal"
    And it shows the share over all closed conversations and its line per bucket

  @unit
  Scenario: AC42 Answer quality: Judges vs reviewers scores agreement per week from reviewer thumbs
    Given the "Judges vs reviewers" widget
    Then it pairs each evaluator's pass or fail with the reviewer thumbs on the same trace from the annotations view
    And it charts Cohen's kappa per evaluator per week against a 0.8 target
    And without reviewer thumbs it shows the setup step for reviewer annotations

  @unit
  Scenario: AC43 Answer quality: To review lists failed checks from the last 3 days with one random audit
    Given the "To review" widget
    Then it lists up to 4 traces a check failed in the last 3 days of the period, each with the check's reason
    And it adds one trace every check passed, picked without regard to its verdicts

  @unit
  Scenario: AC44 Answer quality: Retrieval or generation splits failed searches by cause
    Given the "Retrieval or generation" widget
    Then a failed trace that searched counts once: as "search found nothing" when a retrieval span returned no contexts
    And otherwise as an error when a span errored, else as a wrong answer when a check failed

  @unit
  Scenario: AC45 Answer quality: Empty retrieval rate counts questions whose search returned nothing
    Given the "Empty retrieval rate" widget
    Then it divides traces with a retrieval span that returned no contexts by traces with a retrieval span, per bucket

  @unit
  Scenario: AC46 What users ask: Requests it cannot serve counts capability gaps per topic
    Given the "Requests it cannot serve" widget
    Then it counts closed conversations with the outcome "capability_gap" per topic, with the most common reason

  @unit
  Scenario: AC47 What users ask: Rising and new topics compares topic shares with the period before
    Given the "Rising and new topics" widget
    Then it compares each topic's share of traces in the period with the equally long period before
    And it marks a topic with no traces in the period before as new
    And with no traces in the period before it says there is nothing to compare with

  @unit
  Scenario: AC48 What users ask: Topics people ask about shows volume, success and cannot-do per topic
    Given the "Topics people ask about" widget
    Then it shows per topic its traces, the resolved share of its closed conversations and its capability gaps
    And without judged outcomes it shows the checks' pass rate instead, under its own header

  @unit
  Scenario: AC49 What users ask: Asked again shows misread conversations and returning users
    Given the "Asked again" widget
    Then it charts the share of closed conversations with the outcome "misunderstood" per bucket
    And it shows the share of people active in the period who were also active in the period before

  # ---------------------------------------------------------------------------
  # Where my agent breaks, and Release check
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC60 Where my agent breaks: errors per day are split by what failed first, with changes marked
    Given the "up-errors" widget
    Then it counts traces with an error per bucket, named by the error type, else the first step below the root that failed
    And it draws the error rate of all traces as a line
    And it marks each prompt version and each newly used model in the period on the time axis
    # Decision: LangWatch records no deploys, so deploys are not marked

  @unit
  Scenario: AC61 Where my agent breaks: failing steps show the failures that reached the user
    Given the "up-where-fails" widget
    Then it lists the steps below the root with their calls, failures and recovered failures
    And a failure counts as recovered when the span above it still ended without an error
    And the steps are ordered by the failures that reached the user

  @unit
  Scenario: AC62 Where my agent breaks: loops and retries are read from repeated spans
    Given the "up-loops" widget
    Then a trace has looped when it calls one tool 3 or more times with the same input
    And a trace has retried when a failed span is followed under the same parent by the same step, or by another model call
    And it shows those traces per bucket, their share of all traces, and the cost of the repeated calls

  @unit
  Scenario: AC63 Where my agent breaks: tool error rate says how many tool errors the agent recovered
    Given the "tools-error-rate" widget
    Then it reads only tool spans
    And it shows the error rate over all tool calls, the share of errors recovered and the worst tool

  @unit
  Scenario: AC64 Where my agent breaks: wrong tool rate reads one named judge
    Given the "tools-wrong-tool" widget
    Then it reads the failures of the evaluator named "Tool choice" per bucket, with changes marked
    And with no results from that evaluator it names the evaluator it needs and shows the setup step

  @unit
  Scenario: AC65 Release check: the newest test run is compared with the runs before it
    Given the "ship-verdict" widget
    Then it compares the newest batch of scenario runs with every earlier batch of the same scenarios in the period
    And a scenario got worse only when its pass rate fell by more than its own flake rate
    And it shows the pass rates, the worse scenarios, the typical run time and the cost per run of both
    # Decision: the scenario view does not name the target a run tested, so the newest batch stands in for the new version

  @unit
  Scenario: AC66 Release check: flaky tests show each scenario's last ten runs
    Given the "ship-flaky" widget
    Then it shows each scenario's last ten runs in the period, oldest first, as passes and fails
    And a scenario is flaky when it both passed and failed and its 95% interval does not place it above 90% or below 10%

  @unit
  Scenario: AC67 Release check: the last test runs are compared with a baseline
    Given the "ship-compare" widget
    Then it shows the last five runs of the suite that ran last, newest first
    And for each it shows scenarios passed, criteria met, cost per scenario and typical run time
    And each figure is coloured against the run before the newest
    # Decision: grader scores are left out until the scenario view exposes its evaluations

  @unit
  Scenario: AC68 Release check: production is compared before and after the newest change
    Given the "ship-rollout" widget
    Then it compares up to 7 days after the newest prompt or model change with the same days a week earlier
    And it shows the error rate, p95 response time and cost per trace on both sides
    And the checks passed after the change are reweighted to the topic mix before it
    And with no change in the period it says there is nothing to compare around

  @unit
  Scenario: AC69 Release check: models are compared from experiments that ran them side by side
    Given the "ship-models" widget
    Then it reads experiment runs with two or more targets, naming each target by its model
    And it shows pass rate, cost per test and p95 reply per model, best quality first

  @unit
  Scenario: AC70 Release check: the test set is weighted to the topic mix of real traffic
    Given the "rag-dataset-versions" widget
    Then it shows each recent run of the experiment that ran last, as run and weighted to production's topic shares
    And production leaves out traces LangWatch's own runs produced
    # Decision: datasets carry no version, so each run stands in for a test-set version

  @unit
  Scenario: AC71 Release check: field accuracy per test run reads two named evaluators
    Given the "ext-precision-recall" widget
    Then it shows the average scores of the evaluators named "Field precision" and "Field recall" for each of the last 12 experiment runs
    And with none of those results it names the evaluators it needs
    # Decision: no allowlisted page sets up experiments, so the experiment widgets show no setup button

  # ---------------------------------------------------------------------------
  # Boards preloaded for one agent kind
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC80 By customer: the board groups by the first key the traces carry
    Given a project whose traces carry a customer id, or a document type, language, team, flow,
      segment or topic in their metadata, or labels
    Then each per-customer widget groups the period's traces by the first of those keys any trace carries
    And it names the unit by that key, such as "customer" or "document type"
    And traces without that key are counted on their own "No customer" row
    # Decision: the keys are the ones the dashboards dev seed sends; a label groups by the first label

  @unit
  Scenario: AC80b By customer: no grouping key says what to send
    Given traces in the period, none carrying a customer id, labels or a grouping key in metadata
    Then the per-customer widgets say that no trace carries one, instead of an empty list

  @unit
  Scenario: AC81 By customer: conversations by customer with each one's share
    Then the widget lists the six customers with the most conversations and each one's share of all
    And it says how many more customers there are
    # A conversation is a thread; a trace without a thread is a conversation of one

  @unit
  Scenario: AC82 By customer: one row per customer with pass rate, the period before and AI cost
    Then each row shows conversations, the judged pass rate, the pass rate the period before,
      AI cost and cost per conversation
    And a pass rate from fewer than 30 judged answers shows "-"
    And the earlier pass rate turns red when the rate fell at least 2 points and beyond chance
    # Verdicts count at the time of the answer they judged, not when the judge ran

  @unit
  Scenario: AC83 By customer: pass rate on the newest prompt version against the one before
    Given a prompt version that first ran in the period, after another version
    Then the widget names both versions and the day the newest started
    And it lists each customer's pass rate on the old version and the new, those that fell first
    And with no new version in the period it says so
    # Decision: version against version over the period, not 7 fixed days around the change

  @unit
  Scenario: AC84 By customer: spend by customer, top six
    Then the widget ranks the six customers that cost the most, untagged traffic as its own row
    And it sums the rest as "and N more customers" with their cost

  @unit
  Scenario: AC85 Call quality: reply time by stage
    Given voice replies, traces with a speech to text or text to speech span
    Then the widget shows the slowest-5% reply time, the largest stage and its share of the reply
    And the stage that grew most from the first half of the period to the second
    And a line per stage over the period
    # Stages: "stt" spans, LLM spans, "tts" spans, summed per reply

  @unit
  Scenario: AC86 Call quality: calls not ended and repeated sentences
    Then the widget counts calls whose last turn ended in an error, per 1,000 calls
    And calls the "Repeated Sentence Check" failed, per 1,000 calls
    And without that check it asks for it instead of showing zero

  @unit
  Scenario: AC87 Field accuracy: accuracy per field and document type
    Given the "Field accuracy per field" check, which lists wrong fields as "Wrong: a, b"
    Then the widget shows each field's share of checked documents right, per document type and overall
    And a cell under 90% is red, and a cell from fewer than 30 documents is faint

  @unit
  Scenario: AC88 Field accuracy: share sent to human review
    Given documents whose metadata says sent_to_review, or whose outcome is a hand-over
    Then the widget shows the share sent to review, against the first half of the period
    And the document type sent most by share of its own documents
    And without either key it says what to send

  @unit
  Scenario: AC89 Outputs users keep: drop-off after generation
    Given outputs whose metadata reports output_action
    Then the widget counts generated, kept or edited, and accepted as is, with the drop at each step
    And it names the step with the biggest drop

  @unit
  Scenario: AC90 Risk sign-off: sign-off status
    Then the widget shows the share of traces the weakest guardrail checked,
      answers a guardrail flagged but did not block against the period before,
      and review items waiting against the start of the period
    And it says "Ready to sign." only when no figure calls for action
    # Thresholds are the prototype's; judge agreement with reviewers is not measured yet

  @unit
  Scenario: AC91 Risk sign-off: policy checks with their margin
    Then the widget shows each judge's pass rate with its 95% margin against a 90% minimum, lowest first
    And guardrails are not listed as policy checks

  @unit
  Scenario: AC92 Risk sign-off: review queue
    Then the widget shows annotation queue items that came in, were reviewed and wait,
      the typical wait, and the pending count over the period

  @unit
  Scenario: AC93 Risk sign-off: change log
    Then the widget lists prompt versions, new evaluators and changed online evaluations in the period,
      newest first, with when each happened

  # ---------------------------------------------------------------------------
  # Templates library
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC100 Templates library: the sidebar opens the library
    Given the dashboards flag is on and a member is on a dashboards page
    Then "Templates" is the last item under Saved dashboards
    And it opens /[project]/dashboards/templates
    And it is marked as the current page while the library is open

  @integration
  Scenario: AC100b Templates library: the library is behind the dashboards gate
    Given the dashboards flag is off for the project
    When a member opens /[project]/dashboards/templates
    Then they see the not-found page

  @unit @integration
  Scenario: AC101 Templates library: every template is listed by trunk, ready ones first
    Given the member opens the templates library with no search and no filters
    Then they see "Dashboard templates" and a one-line introduction
    And every catalogue template is listed once, in sections Profit, Growth, Protect and Foundation
    And inside each section the templates that can be made today come before those coming soon
    And each section header, card accent and trunk badge carries its trunk's colour

  @unit
  Scenario: AC102 Templates library: search matches name, job, widget questions and agent kinds
    When the member searches the library
    Then a template is listed when its name, its job, one of its widgets' questions
      or one of its agent kinds contains the search, ignoring case

  @unit
  Scenario: AC103 Templates library: filter chips narrow by trunk, agent kind and readiness
    Given filter chips for each trunk, each agent kind, Ready and Coming soon, each with "All"
    When the member picks chips
    Then picking several chips in one group shows templates matching any of them
    And chips in different groups all apply together
    And "All" clears that group
    And a template that names no agent kind suits every agent kind
    And each chip counts the templates it would show with the search and the other groups applied

  @unit @integration
  Scenario: AC104 Templates library: the search and filters are kept in the address
    When the member searches or picks a chip
    Then the address carries the search and the picked chips
    And opening that address shows the same view

  @integration
  Scenario: AC105 Templates library: no match says so and offers to clear the filters
    Given a search and filters that match no template
    Then the library says no template matches
    And clearing the filters shows every template again

  @integration
  Scenario: AC106 Templates library: a ready template creates a board, a coming-soon one cannot
    Then each card shows a preview, the name, the job, the trunk, the number of widgets
      and the agent kinds it suits
    And "Create board" on a ready template makes the same board as picking it on a blank board, and opens it
    And a coming-soon card says how many of its widgets are built and cannot create a board

  # ---------------------------------------------------------------------------
  # Guard rails
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: AC11 Existing boards are unaffected
    Given a board created before this change
    Then its widgets keep their stored code, labels and number format
    # Decision: no migration of stored widget code in this PR; new templates only

  # --- AC Coverage Map ---
  # AC 1: "The empty board has no 'Add a block' box" → Scenario: AC1 The empty board has no "Add a block" box
  # AC 2: "Template cards say what the board shows" → Scenario: AC2 Template cards say what the board shows
  # AC 3: "A status tile without an earlier period says so" → Scenario: AC3 A status tile without an earlier period says so
  # AC 4: "Money has cents" → Scenario: AC4 Money has cents
  # AC 5: "The board uses a wide screen" → Scenario: AC5 The board uses a wide screen
  # AC 6: "Template tables are shorter than template charts" → Scenario: AC6 Template tables are shorter than template charts
  # AC 7: "The board shows data age and can refresh" → Scenario: AC7 The board shows data age and can refresh
  # AC 8: "An MCP agent adds a widget to a board" → Scenario: AC8 An MCP agent adds a widget to a board; Scenario: AC8b add_dashboard_widget rejects an unknown dashboard
  # AC 9: "The docs explain how to build boards from an agent" → Scenario: AC9 The docs explain how to build boards from an agent
  # AC 10: "A non-empty board still offers a way to add a widget" → Scenario: AC10 A non-empty board still offers a way to add a widget
  # AC 19: "One control for range, grain and refresh, with Live" (added by langwatch/tasks#911: the refresh menu moves into the period control) → Scenario: AC19 One control sets the range, the grain and the refresh; Scenario: AC19b A grain that does not fit the range cannot be picked; Scenario: AC19c Live is the last hour, rolling, refreshed every minute
  # AC 11: "Existing boards are unaffected" → Scenario: AC11 Existing boards are unaffected
  # AC 12: "A picked question adds its widget and seeds Langy" (added by langwatch/tasks#911: the picker adds widgets and drafts Langy, no longer only asks) → Scenario: AC12 A picked question adds its widget and seeds Langy; Scenario: AC12b Without Langy a picked question still adds its widget; Scenario: AC12c A failed add keeps the picker open and does not seed Langy
  # AC 13: "An empty widget tells a quiet period from a missing source" (added by langwatch/tasks#911: no rows no longer means not connected) → Scenario: AC13 A quiet period does not ask the member to connect a source; Scenario: AC13b A source that was never set up shows its setup step; Scenario: AC13c Every template widget checks its own source
  # AC 14: "Reviewer thumbs are named as reviewer thumbs" (added by langwatch/tasks#911: the annotations table holds reviewer thumbs, not user feedback) → Scenario: AC14 Reviewer thumbs are named as reviewer thumbs
  # AC 15: "One catalogue of widgets and templates, from the dashboards library" (added by langwatch/tasks#911: the library is the guide for what to build) → Scenario: AC15 Every widget answers a question from the question tree; Scenario: AC15b A project's preloaded boards never repeat a widget; Scenario: AC15c The prototype's boards are the starter set, under the Agent Flight Deck name
  # AC 16: "The picker offers the catalogue" (added by langwatch/tasks#911: the picker moves from answer shapes to the question tree) → Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
  # AC 17: "Everything is listed, coming soon until built" (added by langwatch/tasks#911) → Scenario: AC17 Every widget and template is listed, coming soon until it is built
  # AC 18: "Default Langy prompts" (added by langwatch/tasks#911) → Scenario: AC18 Every widget and template carries a default Langy prompt
  # AC 40: "Answer quality: how conversations ended" → Scenario: AC40 Answer quality: How conversations ended reads the app's outcome first, then the judge
  # AC 41: "Answer quality: unanswered by topic" → Scenario: AC41 Answer quality: Unanswered, by topic is the refused share of closed conversations per topic
  # AC 42: "Answer quality: judges vs reviewers" → Scenario: AC42 Answer quality: Judges vs reviewers scores agreement per week from reviewer thumbs
  # AC 43: "Answer quality: to review" → Scenario: AC43 Answer quality: To review lists failed checks from the last 3 days with one random audit
  # AC 44: "Answer quality: retrieval or generation" → Scenario: AC44 Answer quality: Retrieval or generation splits failed searches by cause
  # AC 45: "Answer quality: empty retrieval rate" → Scenario: AC45 Answer quality: Empty retrieval rate counts questions whose search returned nothing
  # AC 46: "What users ask: requests it cannot serve" → Scenario: AC46 What users ask: Requests it cannot serve counts capability gaps per topic
  # AC 47: "What users ask: rising and new topics" → Scenario: AC47 What users ask: Rising and new topics compares topic shares with the period before
  # AC 48: "What users ask: topics people ask about" → Scenario: AC48 What users ask: Topics people ask about shows volume, success and cannot-do per topic
  # AC 49: "What users ask: asked again" → Scenario: AC49 What users ask: Asked again shows misread conversations and returning users
  # AC 60-71: "Where my agent breaks" and "Release check" widgets are built from the prototype's cards → Scenario: AC60 to Scenario: AC71
  # AC 80-93: "The boards preloaded for one agent kind are built" (By customer, Call quality, Field accuracy, Outputs users keep, Risk sign-off) → Scenario: AC80 By customer: the board groups by the first key the traces carry; Scenario: AC80b By customer: no grouping key says what to send; Scenario: AC81 By customer: conversations by customer with each one's share; Scenario: AC82 By customer: one row per customer with pass rate, the period before and AI cost; Scenario: AC83 By customer: pass rate on the newest prompt version against the one before; Scenario: AC84 By customer: spend by customer, top six; Scenario: AC85 Call quality: reply time by stage; Scenario: AC86 Call quality: calls not ended and repeated sentences; Scenario: AC87 Field accuracy: accuracy per field and document type; Scenario: AC88 Field accuracy: share sent to human review; Scenario: AC89 Outputs users keep: drop-off after generation; Scenario: AC90 Risk sign-off: sign-off status; Scenario: AC91 Risk sign-off: policy checks with their margin; Scenario: AC92 Risk sign-off: review queue; Scenario: AC93 Risk sign-off: change log
  # AC 100-106: "Templates library" → Scenario: AC100 Templates library: the sidebar opens the library; Scenario: AC100b Templates library: the library is behind the dashboards gate; Scenario: AC101 Templates library: every template is listed by trunk, ready ones first; Scenario: AC102 Templates library: search matches name, job, widget questions and agent kinds; Scenario: AC103 Templates library: filter chips narrow by trunk, agent kind and readiness; Scenario: AC104 Templates library: the search and filters are kept in the address; Scenario: AC105 Templates library: no match says so and offers to clear the filters; Scenario: AC106 Templates library: a ready template creates a board, a coming-soon one cannot
