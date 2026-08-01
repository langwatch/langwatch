@unimplemented
Feature: Langy is tested with LangWatch's own scenario and evaluation tooling
  As the owner of the Langy in-product assistant
  I want Langy exercised by LangWatch's own scenarios and evaluators
  So that we dogfood the platform and catch behaviour regressions in Langy the
  same way our customers catch regressions in their agents

  # Design: ADR-050. Scenarios run through @langwatch/scenario in a test-runner
  # process; the reporting API key lives only there, never in the platform
  # process (the platform self-reference guard forbids it and exempts the
  # scenario subprocess).

  # ---------------------------------------------------------------------------
  # Named flows from the ask
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A scenario checks that Langy finds and summarises failing traces
    Given a Langy dogfood scenario for finding failing traces
    When the scenario runs against Langy
    Then Langy reports on the failing traces and explains them in one turn
    And the judge confirms Langy did not ask a clarifying question
    And the judge confirms Langy did not offer next actions

  @integration
  Scenario: A scenario checks that Langy opens a pull request
    Given a Langy dogfood scenario for opening a pull request
    When the scenario runs against Langy
    Then Langy opens a real PR or reports the concrete blocker
    And the judge confirms Langy did not ask for a GitHub token

  @integration
  Scenario: A multi-turn scenario checks that Langy drills in using prior context
    Given a Langy dogfood scenario that lists failing traces then asks about the worst one
    When the scenario runs against Langy
    Then on the follow-up Langy drills into a trace it already surfaced
    And Langy uses the concrete id from the prior turn rather than re-listing

  @integration
  Scenario: A greeting gets a friendly hello, never a refusal
    Given a Langy dogfood scenario where the user opens with "hi"
    When the scenario runs against Langy
    Then Langy replies with one short friendly line that introduces it as Langy
    And the reply names a few things Langy can help with
    And the judge confirms Langy did not reply "Can't do that yet." to the greeting
    And a follow-up "who are you?" gets the same friendly treatment, not a refusal

  @integration
  Scenario: An open "what has my agent been up to?" is answered from traces, not a dead end
    Given a Langy dogfood scenario on a project with traces but no evaluation runs
    When the user asks what their agent has been up to
    Then Langy describes the actual trace activity with concrete observations
    And Langy does not stop at an empty evaluation metric
    And the reply ends by inviting the user to name what to dig into more deeply

  @integration
  Scenario: An ambiguous "make me an eval" is asked about before anything is created
    Given a Langy dogfood scenario where the user says only "make me an eval"
    When the scenario runs against Langy
    Then Langy asks one short question distinguishing a batch experiment from an online evaluator
    And Langy creates nothing before the user answers
    And after the answer, Langy creates the matching resource and the create succeeds
    And the judge confirms that a create rejected over a type slug is corrected from the
      error's accepted values and retried once, never turned into a question

  # ---------------------------------------------------------------------------
  # The inline card channel rests on prompt rules, so it gets an eval (ADR-060)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A scenario checks that Langy draws an uncommandable view as a derived card
    Given a Langy dogfood scenario asking to plot two columns of a dataset against each other
    When the scenario runs against Langy
    Then Langy's reply carries a langy-card fence that validates as a derived-safe kind
    And the judge confirms Langy did not draw an ASCII chart or markdown table in prose
    And the judge confirms Langy did not hand-sum a figure a command computes

  @integration
  Scenario: A scenario checks that Langy asks a user-owned choice as a choices card
    Given a Langy dogfood scenario where a scenario run needs an agent picked from several
    When the scenario runs against Langy
    Then Langy's reply ends with a choices card naming the real agents by id
    And the turn settles with no in-flight work awaiting the answer
    And the judge confirms Langy offered no prose options and invented no id

  # ---------------------------------------------------------------------------
  # The judge rubric is Langy's own rules
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The judge grades Langy against its absolute rules
    Given the shared Langy rule-adherence criteria
    When any Langy dogfood scenario is judged
    Then the criteria require terseness, acting immediately, and no command narration

  # ---------------------------------------------------------------------------
  # A live-traffic evaluator, created without a platform API key
  # ---------------------------------------------------------------------------

  Scenario: A rule-adherence evaluator can grade Langy's live traces
    Given a staff project with Langy traffic
    When a rule-adherence LLM evaluator is created server-side and bound as a monitor
    Then it grades Langy's replies on the project's own traces
    And no LANGWATCH_API_KEY is required to create or run it
