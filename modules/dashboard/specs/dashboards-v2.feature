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
  Scenario: AC10 A non-empty board still offers a way to add a widget
    Given a board with at least one widget
    Then "Add a widget" in the header and the "Add a widget" box below the widgets
      both open the picker
    # Evidence: screenshot of a board with widgets and its add control

  @e2e @unimplemented
  Scenario: AC2 Template cards say what the board shows
    Given a member opens the templates library
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

  @unit
  Scenario: AC3c A status tile caps a change past tenfold
    Given the current period has more than eleven times the figure of the period before
    When the Status widget renders
    Then the tile's change reads "999%+", as the legacy summary tiles do

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

  @integration
  Scenario: AC7 Refresh sits inside the period menu
    When a member opens the period menu on a board
    Then "Refresh now" is its last item and reloads every widget
    And the board shows no "Updated just now" and the period pill no "· auto"
    # Evidence: screenshot of the open period menu

  @integration
  Scenario: AC19 One control sets the range, the grain and the refresh
    Given a member opens a board
    Then the header has one period control showing the range, and the grain when it is not auto,
      such as "30d" or "30d · 1d", and never the refresh
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
  Scenario: AC12c A failed add takes the widget off again and does not seed Langy
    Given a board with Langy enabled and the member may start a conversation
    When the member picks a question and the widget write is rejected
    Then the picker has closed and the board says the widget could not be added
    And no widget is stored on the board
    And Langy opens no conversation
    # Changed 2026-10-08 (owner list): a pick closes the picker at once, see "Add a widget: a
    # picked widget shows on the board at once" in dashboards-widget-flow.feature

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
    Then each template widget with a source to connect or set up stores a query that asks
      whether its source sent data in the last 90 days
    And the widget runs that query only when its own queries return nothing
    # A trace field such as a conversation id is named by the query's completeness report instead

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
  Scenario: AC15c The prototype's boards are the starter set, under the Agent health name
    Given the dashboards catalogue
    Then the default template is named "Agent health" and every application agent kind gets it,
      or its focus template for that kind, preloaded
    And coding agents get the six personal boards preloaded instead
    And the library's own templates are in the gallery only
    # Decision (2026-10-07): the prototype names the Cockpit board "Agent health"; "Flight deck"
    # is the org-wide board, future scope

  @unit @integration
  Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
    Given the picker is open on a board
    Then each branch of the question tree with a built widget is a section, in tree order
    And each section lists its built widgets by the question they answer
    And picking one stores it on the board under that question, as AC12 describes
    # Decision (2026-10-07): a catalogue widget without code is not listed at all

  @unit
  Scenario: AC17 Only what is built is offered
    Given the "Add a widget" picker or the templates finder is open
    Then the picker lists only widgets with code, and the finder only templates whose every widget has code
    And the gallery still holds every catalogue template, a coming-soon one saying how many of its widgets are built

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
    And the card shows the problem and its figure, and the sentence that explains it is its hover

  @unit
  Scenario: AC23 Flight Deck: Top request my agent cannot serve names a topic, a count and an example
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
    And it shows the month to date run on to month end at the pace of the last 7 days,
      counting only the days that had traces
    # Missing in LangWatch: a project budget, so the prototype's budget figure is not shown

  @unit
  Scenario: AC29 Running costs: Production vs testing splits spend by where it came from
    Given the "Production vs testing" widget on a board
    Then it splits spend per bucket by trace origin into production, evaluations, simulations and experiments
    And evaluator runs count as evaluations
    And it shows the share of the spend that is test traffic as one figure, with no sentence

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
  Scenario: AC46 What users ask: Requests my agent cannot serve counts capability gaps per topic
    Given the "Requests my agent cannot serve" widget
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
  Scenario: AC61b Where my agent breaks: a top-level span with nothing below it is a step
    Given the "up-where-fails" and "tools-error-rate" widgets
    And a trace whose spans are not nested, such as a trace of one span
    Then each top-level span with no span below it counts as a step
    And its failure counts as reaching the user
    # Fix 2026-10-08: traces with no child spans made the widget say "No spans in this period"

  @unit
  Scenario: AC166 Can I trust my numbers?: data health names each missing field and what it unlocks
    Given the "data-health" widget
    Then it shows the share of traces in the period that carry a model, cost, user, conversation, labels and an outcome
    And each field it reads is a filter, so a missing field shows as a gap on the card, never as a setup view
    And each field missing on some traces says what to send and how many built widgets read it
    And its hover lists those widgets by their question
    And when every field is on every trace it says "Every field arrives" with a check, filling the card

  @unit
  Scenario: AC167 Can I trust my numbers?: cost accuracy counts traces with a model but no price
    Given the "cost-accuracy" widget
    Then it shows the share of traces with a model that have a span with no price, per bucket
    And it lists the models with no price by the traces that used them
    And its info tip says traces stored before 7 October 2026 have no unpriced record
    And when nothing is unpriced it says "All costs priced" with a check, filling the card

  @unit
  Scenario: AC168 Can I trust my numbers?: noise is traffic that clearly comes from tests, staging and the like
    Given the "noise" widget
    Then a trace is noise when its origin is evaluation, simulation or playground
    Or when its span resource attribute deployment.environment, its metadata environment or a label names a test, staging or dev environment
    And it shows each source's traces, its share of traffic and its share of cost
    And it counts no health checks or duplicates
    And when nothing is noise it says "No test traffic" with a check, filling the card
    # Owner, 2026-10-08: noise is traffic that clearly comes from tests, staging and the like

  @unit
  Scenario: AC61c Board cards: a list card is as tall as its longest list
    Given the failing steps, the release verdict and the flaky tests widgets
    Then each is a list card the height of a table, beside the table it pairs with
    And it lists no more rows than that card holds: 3 failing steps, 4 changed scenarios, 5 flaky scenarios

  @unit
  Scenario: AC62 Where my agent breaks: loops and retries are read from repeated spans
    Given the "up-loops" widget
    Then a trace has looped when it calls one tool 3 or more times with the same input
    And a trace has retried when a failed span is followed under the same parent by the same step, or by another model call
    And it shows those traces per bucket, their share of all traces, and the cost of the repeated calls
    And that cost reads as a lower bound, marked "+", when a repeated span carries no cost

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
    And the card face carries no ship or hold sentence
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
    And a figure that calls for action is red, and the card face carries no sign-off sentence
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
  Scenario: AC100b Templates library: the library is behind the dashboards gate
    Given the dashboards flag is off for the project
    When a member opens /[project]/dashboards/templates
    Then they see the not-found page

  @unit @integration
  Scenario: AC101 Templates library: every ready template is listed by trunk
    Given the member opens the templates finder with no search and no filters
    Then they see "Dashboard templates" and a one-line introduction
    And every template that can be made today is listed once, in sections Grow, Protect, Profit and Trust
    And inside each section each template comes before its focus templates
    And each section header carries its trunk's colour

  @unit
  Scenario: AC102 Templates library: search matches name, job, widget questions and agent kinds
    When the member searches the library
    Then a template is listed when its name, its job, one of its widgets' questions
      or one of its agent kinds contains the search, ignoring case

  @unit @integration
  Scenario: AC103 Templates library: one category chip and one agent-type chip narrow the finder
    Given one plain search, the category chips "All", Grow, Protect, Profit and Trust,
      and a chip for each agent type with something made for it
    When the member picks a category
    Then only that category's templates are listed, with the search applied
    And clicking the picked category again, or "All", clears it
    And there is no "Any agent" chip and no coding agent chip
    And each category counts the templates it would show with the search applied

  @unit @integration
  Scenario: AC104 Templates library: the search and filters are kept in the address
    When the member searches or picks a chip
    Then the address carries the search, the category and the agent type
    And opening that address shows the same view

  @integration
  Scenario: AC105 Templates library: no match says so and offers to clear the filters
    Given a search and filters that match no template
    Then the library says no template matches
    And clearing the filters shows every template again

  @integration
  Scenario: AC106 Templates library: a template creates a board for the whole project
    Then each card shows a preview, the name, the job and the number of widgets
    And "Add to this project" makes a board for the whole project, named after the template,
      opens it and drafts the template's report prompt in Langy, unsent

  @integration
  Scenario: AC107c Templates library: each card reads like the prototype's
    Given the templates finder
    Then each card shows, in order: the name, what the board is for, a short preview with
      the number of widgets in a pill over its bottom-right corner, then one footer row
    And the footer row holds "Add to this project" on the left, and on the right the agent type
      a focus template is made for, then the category as a coloured icon badge named by its hover
    And a card shows no status
    And the footer has one height on every card, so the buttons line up across a row
    # Owner, 2026-10-08: no empty space above the button
    And the cards fill the page's width: one to a row on a phone, up to three on a wide screen
    # Evidence: screenshot of the finder beside the prototype's gallery

  @unit @integration
  Scenario: AC107d Templates library: a card previews the template's real board
    Given a template with a captured image of its board
    Then its preview shows the top of that image in a short inset frame
    And a template without an image shows faint blocks, with no text, where its widgets sit on the board
    And the preview runs no query and cannot be focused

  @integration
  Scenario: AC107 Sidebar menu: each board offers its actions in order
    Given a member opens the "⋮" menu of a board in the sidebar
    Then they see Star or Unstar, then Move up and Move down when it is starred,
      a separator, Rename, Duplicate, a separator and Delete, each with its icon
    And Delete is in red
    And a From LangWatch board offers Star or Unstar, the moves when starred, and "Duplicate to edit"
    And there is no Share action anywhere; who sees a board is its scope (AC178)

  @integration
  Scenario: AC107b Sidebar menu: reorder is bounded by the Starred list's ends
    Given a member opens the "⋮" menu of the first starred board
    Then Move up is disabled
    When they open the "⋮" menu of the last starred board
    Then Move down is disabled

  @integration
  Scenario: AC109 Sidebar menu: Duplicate copies the board and its widgets
    When the member picks Duplicate on a board
    Then a new board named "<name> copy" is made, starred by nobody
    And every widget on the board is copied to it at the same place
    And the new board opens
    # Decision: no server procedure copies a board; the browser repeats the create and widget writes

  # ---------------------------------------------------------------------------
  # Dashboards page and favourites (langwatch/tasks#911)
  # ---------------------------------------------------------------------------

  @unit @integration
  Scenario: AC155 Move up and Move down reorder the member's stars
    Given the member has several starred boards, some of them From LangWatch boards
    When the member picks Move up on a board in the sidebar
    Then that board swaps with the one above it and the new order is saved

  @unit
  Scenario: AC156 No board is starred unless the member stars it
    Given a member creates a board, duplicates one, or adds one from a template
    When the board is made
    Then it is starred for nobody, its creator included
    # My dashboard is the one exception: it starts starred for its maker (AC160b)

  @unit
  Scenario: AC157 Stars are per member
    Given one member stars a board
    When another member lists their starred boards
    Then that board is not among them

  # ---------------------------------------------------------------------------
  # Board scope: Only me, Project, Organization (owner decisions, 2026-10-09).
  # A board belongs to one project and has a scope, as a prompt does. An
  # Organization board is one shared definition: in each project of the
  # organization it shows that project's data, with the reader's own permissions.
  # AC159 "No sharing control appears anywhere" is retired by these.
  # Not built: share links or pages, named people or groups, folders, and
  # boards that mix several projects.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC170 Scope: a new board starts at Project and My dashboard at Only me
    When a member creates a board, duplicates one or adds one from a template
    Then its scope is Project, and the project it was made in owns it
    And a member's My dashboard is made with the scope Only me
    And a board made with a project credential has the scope Project

  @unit @integration
  Scenario: AC171 Scope: an Only me board exists for its author alone
    Given a board its author set to Only me
    When another member of the project, or a project credential, lists the boards or the
      starred boards, opens the board by its id, renames, deletes, reorders, stars or copies it,
      or reads, adds, edits, moves or deletes a widget, graph or saved chart on it
    Then every one of these answers as it does for a board that does not exist
    And the author lists it, opens it and edits it as before
    And a LangWatchQL query reads neither the board nor what is placed on it, for any caller:
      a query names no reader, so the "dashboards" and "custom_graphs" views leave them out

  @unit @integration
  Scenario: AC172 Scope: an Organization board is listed in every project of its organization
    Given a board its author set to Organization
    When a member with analytics:view lists the boards of another project of the same organization
    Then the board is listed there, marked as owned by the other project
    And it opens there by its id, with its widgets, for a member and for a project credential
    And a project of another organization neither lists it nor opens it

  @unit @integration
  Scenario: AC173 Scope: an Organization board is read-only outside the project that owns it
    Given an Organization board opened in a project that does not own it
    When the reader renames it, describes it, deletes it, changes its scope,
      or adds, edits, moves or deletes a widget on it
    Then the server refuses each write and the board is unchanged
    And the same writes are accepted in the project that owns it
    And a member may star it, and copy it into the project they are in

  @unit
  Scenario: AC174 Scope: only the author changes a board's scope
    Given a board made by one member
    When another member, a project administrator or a project credential changes its scope
    Then the server refuses with "dashboard_scope_author_only" and the scope is unchanged
    And a board with no recorded author keeps the scope Project
    And who may edit or delete a board is still the analytics permissions' to say

  @unit
  Scenario: AC175 Scope: any board can be set to Only me, My dashboard like any other
    Given a member with several boards of their own
    Then they can set every one of them to Only me, with no limit
    And they can set their My dashboard to Project or Organization, and back to Only me

  @unit
  Scenario: AC176 Scope: a narrower scope keeps other members' stars
    Given a board other members starred
    When its author sets it to Only me
    Then it leaves the other members' starred lists
    And their stars come back when the author widens the scope again
    And a star on an Organization board is one star: it shows in every project that lists the board

  @unit @integration
  Scenario: AC177 Scope control: the board header shows the scope beside the title
    Given a board opened by its author in the project that owns it
    Then a control beside the title names the scope, "Only me", "Project" or "Organization",
      with a lock, people or building icon, as the prompt scope picker does
    When they open it
    Then it is titled "Scope" with "Who can see this dashboard.", and offers Only me "Only you",
      Project "Everyone in <project>" and Organization "Everyone in <organization>, in each of
      their projects", with a tick on the current one
    And a reader who is not the author sees the same value as a badge that cannot be opened,
      whose hover says only the person who made the dashboard can change its scope

  @integration
  Scenario: AC178 Scope control: the sidebar menu offers the same three choices
    When the author opens the "⋮" menu of their board in the sidebar
    Then under "Scope" it offers Only me, Project and Organization with a tick on the current one
    And their My dashboard offers the same three
    And a board they did not make, or one another project owns, offers none

  @unit @integration
  Scenario: AC179 Scope change: it asks first only when someone loses the board
    When the author sets a board to Only me that other members starred
    Then a confirmation says how many other people starred it before anything changes
    When the author lowers a board from Organization to Project or Only me
    Then a confirmation says the other projects will no longer see it
    And cancelling either leaves the scope as it was

  @unit @integration
  Scenario: AC180 Scope change: any other change is made at once and offers Undo
    When the author widens a board, or sets a board nobody else starred to Only me
    Then the scope changes at once, with no confirmation
    And a note names the new audience and offers "Undo", which puts the scope back

  @unit @integration
  Scenario: AC181 Sidebar: scope marks and the organization's group
    Then an Only me board carries a small lock by its name and an Organization board a building
    And a Project board carries no mark
    And the Organization boards other projects own sit in their own group "From <organization>",
      by name, after Starred and before From LangWatch, unless the member starred them
    And with no such board there is no such group

  @unit @integration
  Scenario: AC182 Organization board: the Project chip says whose data it shows
    Given an Organization board
    Then its header has a chip "Project <project>", naming the project whose data is on screen
    When the reader opens the chip
    Then it lists the projects of the organization they can open, one to choose, with no
      "All projects", and marks the project that owns the board "owner"
    And choosing one opens the same board under that project
    And a Project or Only me board has no such chip

  @integration
  Scenario: AC183 A board the reader may not open is not available
    Given the address of a board that was deleted, or that its author set to Only me
    When a member who is not its author opens it
    Then the page reads "This dashboard is not available" and "It was deleted, or the person who
      made it set its scope to Only me. If you need it, ask them to set it to Project."
    And it shows nothing of the board's name, description or widgets

  @unit @integration
  Scenario: AC184 View-only: a board the reader cannot edit offers no edit control
    Given an Organization board opened in a project that does not own it,
      or any board opened by a member without analytics:update
    Then there is no "Add a widget", no add card, no widget menu action that edits, duplicates
      or deletes, and nothing can be moved or resized
    And the widget menu still offers "Copy widget id" and "Export CSV", which change nothing
    And the description cannot be edited, and the sidebar menu offers no Rename and no Delete
    And outside the owning project the header reads "<organization> · owned by <project>"

  @integration
  Scenario: AC185 View-only: Duplicate to edit makes the reader's own copy
    Given a board the reader cannot edit, and a reader with analytics:create
    When they pick "Duplicate to edit" in the board's sidebar menu
    Then a copy with every widget is made in the project they are in, at the scope Project,
      with them as its author, and it opens
    And a reader without analytics:create is offered no copy
    And the board's header has no such button, as on a From LangWatch board

  @unit @integration
  Scenario: AC186 Scope: the migration keeps today's audience
    Given the boards that exist before the scope column
    When the scope migration runs
    Then every board has the scope Project, except each member's own "My dashboard", which is Only me
    And the migration only adds: a column with a default, a nullable column and an index

  @unit @integration
  Scenario: AC187 Scope: an alert or a scheduled report reads nothing from an Only me board
    Given a chart-builder graph on a board its author set to Only me
    When a member attaches a graph alert to that graph, or schedules a report on the graph or the board
    Then the alert is refused as it is for a graph the project does not have
    And the report is sent as it is for a board or a graph that does not exist: no chart, no title
    And the automations list names no such graph beside an alert that watches one
    And an alert or a report already there reads the graph again once the author widens the board
    # Automation has no reader at send time, so it stands where a project credential does (AC171).

  @integration
  Scenario: AC188 Scope: an Organization board of an archived project is listed nowhere
    Given an Organization board whose project was archived
    When a member of another project of the organization lists the boards, opens it by its id
      or reads their starred boards
    Then it is in none of them, and their star on it is kept but not listed
    And the archived project still reaches its own board

  @unit
  Scenario: AC189 Scope: board scope reaches only a project where Dashboards is switched on
    Given a project where Dashboards is switched off
    When a member's My dashboard is made there
    Then its scope is Project, since nothing there offers the scope to widen it
    When a member or a project credential of that project lists or opens an Organization board
      another project owns
    Then every answer is the one a board that does not exist gets
    And the project that owns a board lists and opens it whether Dashboards is on there or not

  # ---------------------------------------------------------------------------
  # Sidebar, My dashboard, From LangWatch and the ask bar (langwatch/tasks#911)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC160 The dashboards area lands on My dashboard
    Given a member with analytics:view who has a board named "My dashboard"
    When they open /[project]/dashboards
    Then their My dashboard opens in place of the area
    And there is no All dashboards page

  @integration
  Scenario: AC160b A member with no My dashboard gets one made, starred for them
    Given a member with no board named "My dashboard"
    When they open /[project]/dashboards
    Then one "My dashboard" is made for them and opens
    And it is in their Starred list, stored as their star, and in nobody else's
    And its scope is Only me, so the server lists it for nobody else (AC170, AC171)
    # Existing members' My dashboards get the same star once, by migration: favourites had not
    # shipped, so none of them could have unstarred one

  @unit
  Scenario: AC160c A member who unstars My dashboard keeps it unstarred
    Given a member's My dashboard is starred
    When they unstar it
    Then it stays unstarred, also after they open Dashboards again

  @unit @integration
  Scenario: AC161 The sidebar lists Your dashboards, Starred and From LangWatch in order
    When the member looks at the Dashboards sidebar
    Then they see "Your dashboards" with a "+", then Starred, then From LangWatch
    And From LangWatch holds Release check, "Can I trust my numbers?" and Where my agent breaks
    And the sidebar has no Browse templates item; a new board offers the templates

  @unit @integration
  Scenario: AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name
    Then the member's My dashboard comes first
    And the project's other boards follow by name, leaving out starred ones
    And another member's My dashboard is listed only once its author widened its scope (AC175)

  @unit @integration
  Scenario: AC161c Starred shows only when the member has stars, in their own order
    Given the member has starred boards and From LangWatch boards
    Then Starred lists each once, in the member's order, and they leave their own group
    And with no stars there is no Starred group

  @integration
  Scenario: AC162 The '+' on Your dashboards makes a blank board at once
    When the member presses "+" by "Your dashboards"
    Then a new blank board is made and opened, with no menu in between
    And the new board offers "Or start from a template"

  @integration
  Scenario: AC163 My dashboard cannot be deleted
    When the member opens the "⋮" menu of their My dashboard
    Then Rename and Delete are disabled
    And its scope is not locked: the menu offers the three scope choices (AC178)

  @integration
  Scenario: AC164 From LangWatch folds only when the member clicks it
    When the member clicks "From LangWatch"
    Then its boards fold away, and stay folded after a reload until it is clicked again

  @integration
  Scenario: From LangWatch: the heading's (i) says what these boards are
    Given the Dashboards sidebar shows the From LangWatch group
    When the member hovers over the (i) beside its heading, or moves keyboard focus to it
    Then it says "Boards LangWatch made for you. They are read-only and improve over time.
      Duplicate one to make a copy you can edit."
    And the heading and its fold control stay exactly where they were
    # Owner list, 2026-10-08; the prototype uses the same words

  @unit @integration
  Scenario: AC165 A star can point at a From LangWatch board
    When the member stars a From LangWatch board
    Then it is listed under Starred and is kept for them per project
    And a star names either a stored board or a template, never both

  @integration
  Scenario: Boards: every board has the ask bar
    Given any stored or From LangWatch board
    Then "What do you want to know?" sits under the header
    And without Langy a stored board keeps it to find a widget, and a From LangWatch board has none

  @integration
  Scenario: Boards: every empty board shows one view
    Given a board with no widgets
    Then it shows the ask bar, the suggested questions,
      "Or start from a template" with the three From LangWatch boards and "View all templates"
    And each card opens its live board

  @integration
  Scenario: Boards: the suggested questions show in full at every width
    Given an empty board with Langy available
    Then each suggested question under the ask bar shows its whole text
    And at a narrow width they wrap onto more lines instead of scrolling or being cut at the edges
    # Owner list, 2026-10-08

  @integration
  Scenario: Boards: the ask bar opens its modal on a click, with the cursor in the modal
    Given the ask bar is a button that looks like a search field and never holds text
    When the member clicks it, or presses Enter or Space on it, on a stored board
    Then "Add a widget" opens at once with the cursor in its search
    And Langy is asked nothing
    # Owner, 2026-10-08: the bar opens the modal; it is not a search of its own

  @integration
  Scenario: Boards: no star or pencil by the board title
    Then the board title has no star and no rename pencil; both live in the sidebar menu

  @integration
  Scenario: Boards: My dashboard has no description placeholder
    Given the member's My dashboard with no description
    Then it shows no "Add a description"
    And every other board without a description offers "Add a description"

  @integration
  Scenario: From LangWatch: a template board is live and read-only
    When the member opens /[project]/dashboards/curated/<template id>
    Then the template's widgets run over the project's data, badged "From LangWatch"
    And nothing can be moved, edited or added, and nothing is stored
    And its header has no "Duplicate to edit" button
    And an unknown template id shows the not-found page

  @unit @integration
  Scenario: From LangWatch: every widget on a template board has code
    Given the From LangWatch boards
    Then every widget on them runs its own query, and none is a placeholder
    And "Can I trust my numbers?" shows data health, cost accuracy, noise and evaluation coverage

  @integration
  Scenario: From LangWatch: Duplicate to edit makes an own board named after the template
    When the member presses "Duplicate to edit" in the board's sidebar menu
    Then a board named "<name> (copy)" is made for the project with the template's built widgets
    And it opens, with the template's report prompt drafted in Langy, unsent
    # The board's header has no such button: the sidebar menu is the only place

  @unit @integration
  Scenario: From LangWatch: a template board asks Langy with the board as context
    When the member clicks the ask bar on a From LangWatch board
    Then Langy opens with the cursor in its composer and nothing asked yet
    And the board is attached as context, named as read-only and not stored

  @unit
  Scenario: Langy drafts: a draft records the board it is about
    When a board or a widget drafts a prompt in Langy
    Then the draft records that board, and the widget when there is one

  @unit
  Scenario: Langy drafts: a draft waits until its board is on screen
    Given a draft about a board that is still loading
    Then the draft stays while another page is on screen, until its board arrives

  @unit
  Scenario: Langy drafts: an unsent draft is dropped when the member moves to another board
    Given a draft that was shown with its board and is untouched
    When the member moves to another board or widget
    Then the draft and its context chip leave the composer

  @unit
  Scenario: Langy drafts: text the member typed is never dropped
    Given the member edited a draft or typed their own text
    When they move to another board
    Then the composer keeps their text

  # ---------------------------------------------------------------------------
  # Widget description and fit
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC110 Widget description: a built widget carries its description, not in its code
    Given a widget built from the catalogue
    Then its stored definition has a description: what the panel is for, then why it matters
    And its stored code no longer draws that line inside the panel

  @integration
  Scenario: AC111 Widget description: the card shows the description behind an info icon
    Given a board with a widget whose definition has a description
    Then the card header shows only the title, with an info icon before the widget menu
    And hovering or focusing the info icon shows the description

  @integration
  Scenario: AC112 Widget description: a widget without a description has no info icon
    Given a board with a widget saved before descriptions existed
    Then its card shows no info icon

  @unit
  Scenario: AC113 Widget description: the description is stored and kept when the code is edited
    Given a widget created with a description
    When its code is edited
    Then the widget still has the description it was created with

  @unit
  Scenario: AC114 Widget fit: the empty face fits a short card
    Given a widget whose source was never set up, on a card of any height
    Then below 220px of frame height the empty face drops its icon
    And below 180px it is one row: title, truncated line and button
    And the button to set the source up is always visible

  @unit
  Scenario: AC115 Widget fit: a widget is never shorter than its title and one-row empty face
    Given a board placement shorter than 3 rows
    When it is laid out, resized or saved
    Then it is 3 rows high

  @unit
  Scenario: AC116 Widget fit: every built widget is at least the minimum height
    Given every catalogue and template widget
    Then each spans at least 3 rows

  # ---------------------------------------------------------------------------
  # Ask Langy about a widget
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available
    Given a board with widgets
    When Langy is on for the project and the member may start a conversation
    Then each card header shows an "Ask Langy" button between the info icon and the widget menu
    And the drag handle, "Ask Langy" and the menu show while the card is hovered or focused,
      while the info icon stays faintly beside the title
    And when Langy is off or the member may not start a conversation, no card shows it

  @integration
  Scenario: AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included
    Given Langy is on for the project and the member may start a conversation
    When the member opens a saved board or a read-only From LangWatch board
    Then every widget card on it has an "Ask Langy" button, shown while the card is hovered or focused
    And on a From LangWatch board it sits beside a menu that holds only Export CSV, and
      clicking it drafts that widget's prompt with the board as context, as on a saved board
    And when Langy is off or the member may not start a conversation, no card shows it

  @unit @integration
  Scenario: AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period
    Given a widget with a stored prompt, a description and named queries
    When the member clicks its "Ask Langy" button
    Then Langy opens with a draft to send, not a sent question
    And the draft starts with the widget's prompt
    And then names the widget, its description and each query with its LangWatchQL
    And ends with the dashboard period and grain
    And the open board is attached as the context
    And long LangWatchQL is cut with a marker so the draft stays within 6000 characters
    # Decision: Langy has no widget context kind; the widget rides in the draft text

  @unit
  Scenario: AC122 Ask Langy: a widget without a stored prompt gets a fallback
    Given a widget saved before prompts existed, or made by Langy
    When the member asks Langy about it
    Then the draft starts with a prompt asking Langy to answer the widget's name over the
      dashboard period and quote the real numbers

  @unit @integration
  Scenario: AC123 Ask Langy: the prompt is stored on built widgets and kept on edit and duplicate
    Given a widget built from the catalogue
    Then its stored definition carries the prompt the picker drafts, naming the views it reads
    And editing its code keeps the prompt
    And duplicating it copies the prompt

  # ---------------------------------------------------------------------------
  # Picker filters: "Add a widget" narrows like the templates finder
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC130 Picker filters: the picker offers the finder's search and chips
    Given the member opens "Add a widget"
    Then its search is the board's ask bar as a field: the same look, size and words, "What do you want to know?"
    And it shows the finder's category chips with "All" and the agent-type chips
    And its header holds "I'll build it myself" beside the close button
    And it is a solid surface over a dimmed, blurred page, readable in light and dark mode
    And it keeps its "Ask Langy" footer, in Langy's colours, while Langy is available
    And the field's "Ask" pill does what the footer's "Ask Langy" does with the typed text, and shows only while Langy is available
    And it never says "block"
    # Owner, 2026-10-09: the field is the bar the member just clicked, not a second control

  @unit @integration
  Scenario: AC131 Picker filters: chips narrow the widgets by category and agent type
    When the member picks a category in the picker
    Then only that category's widgets are listed, with the search applied, and picking it again lists all
    When the member picks an agent type
    Then only the widgets made for that type are listed
    # Decision: the picker and the templates finder narrow with one shared catalogue filter

  @unit @integration
  Scenario: AC132 Picker filters: each chip counts the widgets it would show
    Given the picker with a search applied
    Then each category counts the widgets it would show with the search applied, and "All" their sum
    And the counts change as the member searches

  @unit
  Scenario: AC133 Picker filters: search matches the question, line, prompt, branch and agent kinds
    When the member types in the picker's search box
    Then a widget matches on its question, its line, its Langy prompt, its branch or its agent kinds, ignoring case

  @unit @integration
  Scenario: AC134 Picker filters: sections are branches in tree order, coloured by trunk
    Given the picker
    Then each branch of the question tree is a section, in tree order, so the trunks run Grow, Protect, Profit, Trust
    And each section heading's icon and each row's icon take the trunk's colour, as in the templates finder

  @integration
  Scenario: AC135 Picker filters: a widget picked from a filtered list is added and drafts its Langy prompt
    Given the member narrowed the picker with a filter
    When they pick a built widget
    Then the picker closes and the widget is stored on the board
    And Langy opens with the widget's prompt ready to send

  @integration
  Scenario: AC136 Picker filters: the filters reset when the picker closes
    Given the member searched and picked chips in the picker
    When they close the picker and open it again
    Then the search is empty, the categories are on "All" and no agent type is picked
    And the address does not carry the picker's filters

  @integration
  Scenario: AC137 Picker filters: no match says so and offers to clear the search and filters
    Given a search and filters that match no widget
    Then the picker says no widget matches and offers Skip to write one with Langy
    And clearing the search and filters lists every widget again

  @unit @integration
  Scenario: AC138 Picker filters: a row names the agent types its widget is made for
    Given a widget made for three agent types or fewer
    Then its row names those agent types after its question
    And a general widget's row names none

  # ---------------------------------------------------------------------------
  # Product direction: templates and widgets hand off to Langy; alerts and reports are actions
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC140 Template pick: the new board opens with the template's report drafted in Langy
    Given Langy is on for the project and the member may start a conversation
    When the member adds a ready template to this project
    Then the new board is made and opened
    And Langy opens with the template's report prompt as a draft to send, not a sent question
    And the draft ends with the dashboard period and grain the new board opens on
    And the new board, with its widgets, is attached as the context

  @unit
  Scenario: Template prompt: Langy also checks what the template needs that is not set up yet
    Given any template, base or focus
    Then its report prompt ends by asking Langy to check what the board needs that the project
      has not set up yet: the data its widgets need (such as cost, user id or evaluator
      results) and integrations not connected
    And it names the pieces the template's widgets need that the member can send or turn on
    And it lists each widget that waits for such data, as "<widget>" needs <data>
    And it asks Langy to say what is missing and offer to help set up each piece
    # Owner list, 2026-10-08. Plain traces and what LangWatch has still to build are not named.

  @integration
  Scenario: AC140b Template pick: without Langy the board is made and nothing is drafted
    Given Langy is off or the member may not start a conversation
    When the member adds a ready template to this project
    Then the new board is made and opened, and Langy is not asked anything

  @integration
  Scenario: AC141 Picker add: a picked widget drafts its own prompt with the widget, as Ask Langy does
    Given Langy is available
    When the member picks a built widget in the "Add a block" picker
    Then the draft is the one "Ask Langy" on that widget's card gives: its prompt, its name,
      description and queries, then the dashboard period

  @unit @integration
  Scenario: AC142 Widget menu: Set an alert drafts Langy to alert on that widget
    Given Langy is available
    When the member picks "Set an alert" in a widget's menu
    Then Langy opens with a draft, not a sent question, asking to set up an alert on that widget:
      which number to watch, the threshold and where to send it
    And the draft names the widget and its queries, then the dashboard period
    # Decision: the automation drawer's graph alerts and reports read builder graphs only, and a
    # stored widget has no series to watch, so Langy sets them up from the widget's queries

  @unit @integration
  Scenario: AC143 Widget menu: Send as a report drafts Langy to schedule that widget
    Given Langy is available
    When the member picks "Send as a report" in a widget's menu
    Then Langy opens with a draft, not a sent question, asking to send that widget as a
      scheduled report: how often and where to send it
    And the draft names the widget and its queries, then the dashboard period

  @integration
  Scenario: AC143b Widget menu: without Langy the menu offers no alert or report
    Given Langy is off or the member may not start a conversation
    Then a widget's menu offers Edit code, Copy widget id, Copy API snippet, Export CSV,
      Duplicate and Delete only, with no Edit with Langy, Set an alert or Send as a report

  @integration
  Scenario: AC144 Template card: the primary button reads Add to this project
    Given a ready template's card
    Then its primary button reads "Add to this project"

  @unit @integration
  Scenario: AC145 Template card: a template already added shows Added, linking to its board
    Given this project has a board named after a template, or numbered from 2 after it
    Then that template's card shows a quiet "Added" link to that board instead of the add button
    And a board renamed away from the template's name no longer counts as added
    # Decision: no board column records its template and adding one needs a migration, so the
    # board is matched by the name it was made with

  @integration
  Scenario: Template card: the category icon names its category and description on hover and focus
    Given a template's card
    When the member hovers over its category icon, or moves focus to it
    Then a tooltip names the category and its one-line description, such as
      "Protect: Can my agent hurt me?"
    # Owner list, 2026-10-08

  # ---------------------------------------------------------------------------
  # Dashboards show your agent, not Langy's work for you
  # ---------------------------------------------------------------------------
  # Why: Langy's own turns trace into the member's project with origin "langy" (ADR-061).
  # Counted, they move volume, cost, latency and error widgets because the member used Langy.
  # The project home and the Explorer already leave them out; Dashboards follow (owner, 2026-10-09).
  # How: analytics ADR-003. This is the server half and the board's default. The built-in Source
  # parameter that shows the default in the board header and lets the member change it comes next.

  @integration
  Scenario: AC190 Langy: every widget on a board leaves out Langy's conversations by default
    Given a project with traces from its own agent and traces with origin "langy"
    When a member opens any board, My dashboard and From LangWatch boards included
    Then every widget counts only the traces whose origin is not "langy"
    And so do the spans, evaluations and other rows that belong to those traces
    And the widget editor's preview counts the same rows as the card
    # Why one place: the board's query context sets it, so no widget can forget it, whether it
    # comes from the catalogue, from Langy or from the code editor

  @unit @integration
  Scenario: AC191 Langy: a widget's own origin filter keeps its meaning
    Given a widget that already reads only production origins, such as Running costs
    When it runs on a board that leaves out Langy's conversations
    Then it reads the same rows it read before
    # Why: the board removes Langy rows first; a row that passes still meets the widget's own
    # filter, so the board never widens or reverses a deliberate filter

  @unit
  Scenario: AC192 Langy: data that is Langy's own is not filtered
    Given a widget that reads Langy's own usage events or conversation messages
    When it runs on a board
    Then it still reads every row
    # Why: those rows are about Langy itself, not traces in the member's project

  @unit @integration
  Scenario: AC193 Langy: the origins a board leaves out are a list a board parameter can set later
    Given the context a board runs every query with
    Then it names the origins it leaves out as a list, "langy" by default
    And an empty list makes every widget read Langy's conversations too
    # Why a list: the built-in Source parameter planned for the header can then show the default
    # and pick origins without a new shape on the wire

  @unit
  Scenario: AC194 Langy: a query run outside a board is not scoped
    Given a LangWatchQL statement run from anywhere but a board, such as the REST query API
    When the run names no origins to leave out
    Then the statement runs as written and reads Langy's conversations too
    # Why: the rule is the board's alone. The Traces list keeps its own rule (ADR-061)

  @unit
  Scenario: AC195 Langy: per-minute rollups cannot leave Langy out yet
    Given a widget that reads trace_metrics_by_minute or model_usage_by_minute
    When it runs on a board
    Then it still counts Langy's spans
    # Known gap: the rollups are written per span before a trace's origin is known, so they
    # carry no origin; a follow-up would add one

  # ---------------------------------------------------------------------------
  # Guard rails
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: AC11 Existing boards are unaffected
    Given a board created before this change
    Then its widgets keep their stored code, labels and number format
    # Decision: no migration of stored widget code in this PR; new templates only

  # --- AC Coverage Map ---
  # AC 1: "The empty board has no 'Add a block' box" (replaced by langwatch/tasks#911: every empty board shows one view) → Scenario: Boards: every empty board shows one view
  # AC 2: "Template cards say what the board shows" → Scenario: AC2 Template cards say what the board shows
  # AC 3: "A status tile without an earlier period says so" → Scenario: AC3 A status tile without an earlier period says so
  # AC 4: "Money has cents" → Scenario: AC4 Money has cents
  # AC 5: "The board uses a wide screen" → Scenario: AC5 The board uses a wide screen
  # AC 6: "Template tables are shorter than template charts" → Scenario: AC6 Template tables are shorter than template charts
  # AC 7: "The board shows data age and can refresh" (changed by langwatch/tasks#911: no data age; Refresh now moves into the period menu) → Scenario: AC7 Refresh sits inside the period menu
  # AC 8: "An MCP agent adds a widget to a board" → Scenario: AC8 An MCP agent adds a widget to a board; Scenario: AC8b add_dashboard_widget rejects an unknown dashboard
  # AC 9: "The docs explain how to build boards from an agent" → Scenario: AC9 The docs explain how to build boards from an agent
  # AC 10: "A non-empty board still offers a way to add a widget" → Scenario: AC10 A non-empty board still offers a way to add a widget
  # AC 19: "One control for range, grain and refresh, with Live" (added by langwatch/tasks#911: the refresh menu moves into the period control) → Scenario: AC19 One control sets the range, the grain and the refresh; Scenario: AC19b A grain that does not fit the range cannot be picked; Scenario: AC19c Live is the last hour, rolling, refreshed every minute
  # AC 11: "Existing boards are unaffected" → Scenario: AC11 Existing boards are unaffected
  # AC 12: "A picked question adds its widget and seeds Langy" (added by langwatch/tasks#911: the picker adds widgets and drafts Langy, no longer only asks) → Scenario: AC12 A picked question adds its widget and seeds Langy; Scenario: AC12b Without Langy a picked question still adds its widget; Scenario: AC12c A failed add takes the widget off again and does not seed Langy
  # AC 13: "An empty widget tells a quiet period from a missing source" (added by langwatch/tasks#911: no rows no longer means not connected) → Scenario: AC13 A quiet period does not ask the member to connect a source; Scenario: AC13b A source that was never set up shows its setup step; Scenario: AC13c Every template widget checks its own source
  # AC 14: "Reviewer thumbs are named as reviewer thumbs" (added by langwatch/tasks#911: the annotations table holds reviewer thumbs, not user feedback) → Scenario: AC14 Reviewer thumbs are named as reviewer thumbs
  # AC 15: "One catalogue of widgets and templates, from the dashboards library" (added by langwatch/tasks#911: the library is the guide for what to build) → Scenario: AC15 Every widget answers a question from the question tree; Scenario: AC15b A project's preloaded boards never repeat a widget; Scenario: AC15c The prototype's boards are the starter set, under the Agent health name
  # AC 16: "The picker offers the catalogue" (added by langwatch/tasks#911: the picker moves from answer shapes to the question tree) → Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
  # AC 17: "Everything is listed, coming soon until built" (changed by langwatch/tasks#911 on 2026-10-07: only what is built is offered) → Scenario: AC17 Only what is built is offered
  # AC 18: "Default Langy prompts" (added by langwatch/tasks#911) → Scenario: AC18 Every widget and template carries a default Langy prompt
  # AC 40: "Answer quality: how conversations ended" → Scenario: AC40 Answer quality: How conversations ended reads the app's outcome first, then the judge
  # AC 41: "Answer quality: unanswered by topic" → Scenario: AC41 Answer quality: Unanswered, by topic is the refused share of closed conversations per topic
  # AC 42: "Answer quality: judges vs reviewers" → Scenario: AC42 Answer quality: Judges vs reviewers scores agreement per week from reviewer thumbs
  # AC 43: "Answer quality: to review" → Scenario: AC43 Answer quality: To review lists failed checks from the last 3 days with one random audit
  # AC 44: "Answer quality: retrieval or generation" → Scenario: AC44 Answer quality: Retrieval or generation splits failed searches by cause
  # AC 45: "Answer quality: empty retrieval rate" → Scenario: AC45 Answer quality: Empty retrieval rate counts questions whose search returned nothing
  # AC 46: "What users ask: requests my agent cannot serve" → Scenario: AC46 What users ask: Requests my agent cannot serve counts capability gaps per topic
  # AC 47: "What users ask: rising and new topics" → Scenario: AC47 What users ask: Rising and new topics compares topic shares with the period before
  # AC 48: "What users ask: topics people ask about" → Scenario: AC48 What users ask: Topics people ask about shows volume, success and cannot-do per topic
  # AC 49: "What users ask: asked again" → Scenario: AC49 What users ask: Asked again shows misread conversations and returning users
  # AC 60-71: "Where my agent breaks" and "Release check" widgets are built from the prototype's cards → Scenario: AC60 to Scenario: AC71
  # AC 80-93: "The boards preloaded for one agent kind are built" (By customer, Call quality, Field accuracy, Outputs users keep, Risk sign-off) → Scenario: AC80 By customer: the board groups by the first key the traces carry; Scenario: AC80b By customer: no grouping key says what to send; Scenario: AC81 By customer: conversations by customer with each one's share; Scenario: AC82 By customer: one row per customer with pass rate, the period before and AI cost; Scenario: AC83 By customer: pass rate on the newest prompt version against the one before; Scenario: AC84 By customer: spend by customer, top six; Scenario: AC85 Call quality: reply time by stage; Scenario: AC86 Call quality: calls not ended and repeated sentences; Scenario: AC87 Field accuracy: accuracy per field and document type; Scenario: AC88 Field accuracy: share sent to human review; Scenario: AC89 Outputs users keep: drop-off after generation; Scenario: AC90 Risk sign-off: sign-off status; Scenario: AC91 Risk sign-off: policy checks with their margin; Scenario: AC92 Risk sign-off: review queue; Scenario: AC93 Risk sign-off: change log
  # AC 100-106: "Templates library" (AC100 retired: the sidebar has no Browse templates item; a new board offers the templates) → Scenario: AC100b Templates library: the library is behind the dashboards gate; Scenario: AC101 Templates library: every ready template is listed by trunk; Scenario: AC102 Templates library: search matches name, job, widget questions and agent kinds; Scenario: AC103 Templates library: one category chip and one agent-type chip narrow the finder; Scenario: AC104 Templates library: the search and filters are kept in the address; Scenario: AC105 Templates library: no match says so and offers to clear the filters; Scenario: AC106 Templates library: a template creates a board for the whole project
  # AC 110-113: "Widget description: the description moves from the stored code to an info tip on the card" → Scenario: AC110 Widget description: a built widget carries its description, not in its code; Scenario: AC111 Widget description: the card shows the description behind an info icon; Scenario: AC112 Widget description: a widget without a description has no info icon; Scenario: AC113 Widget description: the description is stored and kept when the code is edited
  # AC 114-116: "Widget fit: a short card keeps its empty face usable" → Scenario: AC114 Widget fit: the empty face fits a short card; Scenario: AC115 Widget fit: a widget is never shorter than its title and one-row empty face; Scenario: AC116 Widget fit: every built widget is at least the minimum height
  # AC 107c-107e: "Templates library: cards like the prototype" (changed by langwatch/tasks#911 on 2026-10-07: compact cards with no labels, so AC107e is gone; the finder's own scenarios are in dashboards-finder.feature) → Scenario: AC107c Templates library: each card reads like the prototype's; Scenario: AC107d Templates library: a card previews the template's real board
  # AC 107-109: "Sidebar menu" (changed by langwatch/tasks#911: stars replace sharing and the default board; Share and Set as default are gone, Move up/down added) → Scenario: AC107 Sidebar menu: each board offers its actions in order; Scenario: AC107b Sidebar menu: reorder is bounded by the Starred list's ends; Scenario: AC109 Sidebar menu: Duplicate copies the board and its widgets
  # AC 150-159: "Dashboards page and favourites" (changed by langwatch/tasks#911: the All dashboards page is gone, nothing but My dashboard is starred automatically) → Scenario: AC155 Move up and Move down reorder the member's stars; Scenario: AC156 No board is starred unless the member stars it; Scenario: AC157 Stars are per member (AC159 "No sharing control appears anywhere" is retired by AC170-186)
  # AC 170-186: "Board scope: Only me, Project, Organization" (owner decisions, 2026-10-09) → Scenario: AC170 Scope: a new board starts at Project and My dashboard at Only me; Scenario: AC171 Scope: an Only me board exists for its author alone; Scenario: AC172 Scope: an Organization board is listed in every project of its organization; Scenario: AC173 Scope: an Organization board is read-only outside the project that owns it; Scenario: AC174 Scope: only the author changes a board's scope; Scenario: AC175 Scope: any board can be set to Only me, My dashboard like any other; Scenario: AC176 Scope: a narrower scope keeps other members' stars; Scenario: AC177 Scope control: the board header shows the scope beside the title; Scenario: AC178 Scope control: the sidebar menu offers the same three choices; Scenario: AC179 Scope change: it asks first only when someone loses the board; Scenario: AC180 Scope change: any other change is made at once and offers Undo; Scenario: AC181 Sidebar: scope marks and the organization's group; Scenario: AC182 Organization board: the Project chip says whose data it shows; Scenario: AC183 A board the reader may not open is not available; Scenario: AC184 View-only: a board the reader cannot edit offers no edit control; Scenario: AC185 View-only: Duplicate to edit makes the reader's own copy; Scenario: AC186 Scope: the migration keeps today's audience
  # AC 187-189: "Board scope: what the access-control review closed" (2026-10-09: automation reads, archived projects, projects with Dashboards off) → Scenario: AC187 Scope: an alert or a scheduled report reads nothing from an Only me board; Scenario: AC188 Scope: an Organization board of an archived project is listed nowhere; Scenario: AC189 Scope: board scope reaches only a project where Dashboards is switched on
  # AC 160-165: "Sidebar, My dashboard and From LangWatch" (langwatch/tasks#911; changed on 2026-10-08: My dashboard starts starred) → Scenario: AC160 The dashboards area lands on My dashboard; Scenario: AC160b A member with no My dashboard gets one made, starred for them; Scenario: AC160c A member who unstars My dashboard keeps it unstarred; Scenario: AC161 The sidebar lists Your dashboards, Starred and From LangWatch in order; Scenario: AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name; Scenario: AC161c Starred shows only when the member has stars, in their own order; Scenario: AC162 The '+' on Your dashboards makes a blank board at once; Scenario: AC163 My dashboard cannot be deleted; Scenario: AC164 From LangWatch folds only when the member clicks it; Scenario: AC165 A star can point at a From LangWatch board
  # Boards, From LangWatch and Langy drafts (langwatch/tasks#911) → the "Boards:", "From LangWatch:" and "Langy drafts:" scenarios
  # AC 120-123: "Ask Langy: hand any widget to Langy with a ready draft" → Scenario: AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available; Scenario: AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included; Scenario: AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period; Scenario: AC122 Ask Langy: a widget without a stored prompt gets a fallback; Scenario: AC123 Ask Langy: the prompt is stored on built widgets and kept on edit and duplicate
  # AC 130-138: "Picker filters: 'Add a widget' narrows like the templates finder" → Scenario: AC130 Picker filters: the picker offers the finder's search and chips; Scenario: AC131 Picker filters: chips narrow the widgets by category and agent type; Scenario: AC132 Picker filters: each chip counts the widgets it would show; Scenario: AC133 Picker filters: search matches the question, line, prompt, branch and agent kinds; Scenario: AC134 Picker filters: sections are branches in tree order, coloured by trunk; Scenario: AC135 Picker filters: a widget picked from a filtered list is added and drafts its Langy prompt; Scenario: AC136 Picker filters: the filters reset when the picker closes; Scenario: AC137 Picker filters: no match says so and offers to clear the search and filters; Scenario: AC138 Picker filters: a row names the agent types its widget is made for
  # AC 140-145: "Product direction: templates and widgets hand off to Langy; alerts and reports are widget actions" → Scenario: AC140 Template pick: the new board opens with the template's report drafted in Langy; Scenario: AC140b Template pick: without Langy the board is made and nothing is drafted; Scenario: AC141 Picker add: a picked widget drafts its own prompt with the widget, as Ask Langy does; Scenario: AC142 Widget menu: Set an alert drafts Langy to alert on that widget; Scenario: AC143 Widget menu: Send as a report drafts Langy to schedule that widget; Scenario: AC143b Widget menu: without Langy the menu offers no alert or report; Scenario: AC144 Template card: the primary button reads Add to this project; Scenario: AC145 Template card: a template already added shows Added, linking to its board
  # AC 190-195: "Dashboards show your agent, not Langy's work for you" (owner, 2026-10-09) → Scenario: AC190 Langy: every widget on a board leaves out Langy's conversations by default; Scenario: AC191 Langy: a widget's own origin filter keeps its meaning; Scenario: AC192 Langy: data that is Langy's own is not filtered; Scenario: AC193 Langy: the origins a board leaves out are a list a board parameter can set later; Scenario: AC194 Langy: a query run outside a board is not scoped; Scenario: AC195 Langy: per-minute rollups cannot leave Langy out yet
