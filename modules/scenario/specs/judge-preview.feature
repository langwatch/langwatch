Feature: LangWatch Judge (preview) as the scenario judge

  As a team running scenarios on LangWatch Cloud
  I want to pick LangWatch Judge (preview) as the judge of a scenario run
  So that runs are judged by LangWatch's own model without bringing a provider key

  The scenario judge is a chat model inside the scenario SDK. LangWatch Judge (preview) is served
  to it as one OpenAI-shaped, non-streamed endpoint on the app, so neither runner changes: the
  prefetch points the judge at that endpoint with the run's own key, the endpoint turns the
  judge's call into a judge-leaf call (modules/instant-eval-judge/specs/
  instant-eval-scenario-judge.feature) and answers with the tool call the judge asked for. It is
  offered behind release_langwatch_judge_preview, on LangWatch Cloud only. A verdict is never made
  up: when nothing can answer, the run ends as an error.

  @unit
  Scenario: The judge's verdict call becomes one leaf call with a criterion per tool property
    Given the scenario judge's verdict request with the finish_test tool, as scenario SDK 1.8.1 sends it
    When it is read
    Then each property of the tool's criteria is a criterion, keyed by its name
    And its text is the criterion the system prompt's criteria block lists at its place, as the benchmark measured it
    And the description is the text of the system prompt's scenario block
    And the content is the judge's user message
    And a later user message is appended to the content, its text parts read

  @unit
  Scenario: A custom system prompt without a scenario block is kept whole
    Given a verdict request whose system prompt has no scenario block
    When it is read
    Then the description is the whole system prompt

  @unit
  Scenario: The judge's turn decision call is read as the decision phase
    Given a request that offers continue_test and make_verdict
    When it is read
    Then it is a decision call with no criteria and those two tools

  @unit @regression
  Scenario: A criterion's text falls back to its description without the Criterion number, then to its key
    Given a verdict request whose criteria block does not list one criterion per key
    When it is read
    Then a criterion's text is its property's description less a leading "Criterion N:"
    And a property with no description is named by its key

  @unit
  Scenario: Trace exploration tools are never passed on
    Given a verdict request that also offers expand_trace, grep_trace and wait_for_traces
    When it is read
    Then the leaf call carries the finish_test tool alone

  @unit
  Scenario: A request that is not a scenario judge call is refused
    Given a chat request with no judge tool
    When it is read
    Then it is refused as invalid, saying the model judges scenario runs only
    And a request offering only one of the two decision tools is refused

  @unit
  Scenario: A streamed request is refused
    Given a judge request that asks for a stream
    When it is read
    Then it is refused as invalid, naming stream

  @unit
  Scenario: A verdict is answered as the judge's finish_test tool call
    Given a judged verdict with a met, an unmet and an inconclusive criterion
    When the answer is formatted
    Then the completion carries one finish_test tool call with passed, failed and inconclusive by key
    And the usage counts the billed input tokens

  @unit @regression
  Scenario: The verdict's arguments fit the scenario SDK's strict finish_test tool
    Given a judged verdict and the finish_test tool scenario SDK 1.8.1 sends
    When the answer is formatted
    Then each criterion carries its requirement, a reasoning and its status, and nothing else
    And the arguments carry the summary reasoning and no verdict field, so the SDK works out the verdict

  @unit @regression
  Scenario: A verdict call that offers the one-shot wait for traces is answered with that wait
    Given a verdict request that offers wait_for_traces beside finish_test
    When it is answered
    Then the answer calls wait_for_traces with no arguments, judging nothing and billing nothing
    And the next verdict request, which no longer offers the wait, is judged

  @unit
  Scenario: A verdict with no explanation lists its criteria, naming no backend
    Given a judged verdict that carries no reasoning
    When the answer is formatted
    Then the reasoning lists the criteria as met, not met or inconclusive

  @unit
  Scenario: A turn decision is answered as the tool the judge offered
    Given a judged decision to continue and one to judge now
    When each is formatted
    Then the completion calls continue_test and make_verdict with no arguments

  @unit
  Scenario: The endpoint answers the judge's call through the judge leaf
    Given LangWatch Cloud with the judge preview flag on
    When the scenario judge posts its verdict call
    Then the judge leaf is asked once for the project the key belongs to
    And the judge gets the finish_test tool call

  @unit
  Scenario: An unavailable judge is an error, never a verdict
    Given the judge leaf answers unavailable
    When the scenario judge posts its call
    Then the endpoint answers 503 and no verdict

  @unit
  Scenario: A spent free budget is a payment-required error
    Given the judge leaf refuses for a spent free budget
    When the scenario judge posts its call
    Then the endpoint answers 402 with the budget message

  @unit
  Scenario: A project outside an organization is refused
    Given LangWatch Cloud and a project with no organization
    When availability is asked for it
    Then it is not available, since no flag rule could name it

  @unit
  Scenario: A project the judge has not learned is refused at the endpoint
    Given the judge leaf refuses for a project it has not learned
    When the scenario judge posts its call
    Then the endpoint answers 403 saying LangWatch Judge (preview) has not learned the project yet

  @unit
  Scenario: A not-on-Cloud answer from the judge leaf is refused in the words used before a run
    Given the judge leaf refuses because it is not configured
    When the scenario judge posts its call
    Then the endpoint answers 403 with the same message a run gets before it starts

  @unit @regression
  Scenario: A caller that disconnects stops the judge's legs
    Given the scenario judge posts its call
    When its connection closes before the answer
    Then the judge leaf is asked with that request's stop signal
    And a retried call runs and is billed again, since the caller sends no stable id

  @unit
  Scenario: The endpoint refuses where the judge preview flag is off
    Given LangWatch Cloud with the judge preview flag off for the organization
    When the scenario judge posts its call
    Then the endpoint answers 403 and the judge leaf is never asked

  @unit
  Scenario: The endpoint refuses on a self-hosted install
    Given an installation that is not LangWatch Cloud
    When the scenario judge posts its call
    Then the endpoint answers 403, no flag is read and the judge leaf is never asked

  @unit
  Scenario: The endpoint needs a project key
    Given a request with no valid key
    When it is posted
    Then the endpoint answers 401

  @unit
  Scenario: The flag is read for the project's organization alone
    Given LangWatch Cloud
    When availability is asked for a project
    Then release_langwatch_judge_preview is read for the project's organization, never the project
    And the judge pickers and the Judge default's save gate ask it at the same level

  @unit
  Scenario: A run judged by LangWatch Judge (preview) is pointed at the app's own endpoint
    Given a run whose judge model is langwatch/judge-preview on LangWatch Cloud with the flag on
    When the run is prefetched
    Then the judge's parameters name the OpenAI-shaped model, the app's judge preview address and the run's key
    And the run records langwatch/judge-preview as its judge model
    And no provider is asked for the judge

  @unit
  Scenario: A run on LangWatch Judge (preview) is refused before it starts where it may not judge
    Given a run whose judge model is langwatch/judge-preview
    When it is prefetched on a self-hosted install, or with the flag off
    Then the run is refused with a message naming LangWatch Judge (preview) and what to pick instead

  @unit @regression
  Scenario: A run on LangWatch Judge (preview) is refused before it starts where it is not set up
    Given LangWatch Cloud with the flag on for the organization
    And a judge route table that names no turn decision backend
    When a run on LangWatch Judge (preview) is prefetched, or the endpoint is called
    Then it is refused with a message saying it is not set up and what to pick instead
    And the judge leaf is never asked to judge

  @unit
  Scenario: An endpoint on an install with no own address is refused
    Given LangWatch Cloud with the flag on and no configured address for this installation
    When a run on LangWatch Judge (preview) is prefetched
    Then it is refused for missing parameters, since the judge has no endpoint to reach

  @unit
  Scenario: LangWatch Judge (preview) cannot play another role
    Given a run whose simulator model is langwatch/judge-preview
    When the run is prefetched
    Then it is refused with a message saying the model can only be the judge

  @unit
  Scenario: The scenario SDK's client reads the endpoint's answer as its tool call
    Given the scenario SDK's own judge on the model the scenario runner builds for it, pointed at the endpoint
    When it asks for a verdict with the finish_test tool forced
    Then it sends the request the module tests read
    And it reads the endpoint's answer as one passed and one failed criterion

  @unit
  Scenario: The judge preview flag is off by default, on Cloud and self-hosted
    Given the feature flag registry
    When release_langwatch_judge_preview is read
    Then it is a product flag that is off by default
    And it is off by default on a self-hosted install
