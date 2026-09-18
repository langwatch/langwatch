Feature: The Instant Evals classifier interface — one judged question, priced and rate limited

  As the platform
  I want one interface between a judged column and whichever model answers it
  So that the eval functions can be swapped onto a different judge without touching LangWatchQL

  Issue: Instant Evals, PR 2b. ADR-136 (amended).

  The shape:
  - `InstantEvalClassifier` takes a text and a list of questions and answers one verdict per
    question. It publishes its own `limits` (state tokens, total tokens, category options)
    and its own `pricing`, so the callers above it hold no provider constant.
  - The shipped implementation calls TypeSafe Jev with LangWatch's own key, never a
    customer key. A deployment with no key gets the null implementation, which answers
    every question as skipped rather than failing the query.
  - Requests are metered by a Redis token bucket shared by every pod, because the quota
    belongs to the platform's key and not to a process.

  Background:
    Given a deployment configured with a classifier key

  # ---------------------------------------------------------------------------
  # Questions and answers
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Each question kind is sent in the shape the classifier names it
    Given a boolean, a score and a category question over one text
    When they are sent
    Then the boolean is sent as a noul question
    And the score is sent as a score question whose levels are the values of its range
    And the category is sent as a choice question whose options carry their descriptions
    And all three travel in one request, keyed by question id

  @unit
  Scenario: A boolean question with criteria carries what counts as yes and what does not
    Given a boolean question with two criteria
    When it is sent
    Then the request names the yes criterion and the no criterion

  @unit
  Scenario: A boolean verdict is a probability, and passing is the probability against the threshold
    Given a classifier answering a probability of 0.72
    When the verdict is read at a threshold of 0.7
    Then the verdict reports the probability 0.72 and passed

  @unit
  Scenario: A score verdict is the probability-weighted mean of its levels
    Given a classifier answering level probabilities of 0.06, 0.63, 0.3, 0.01 and 0 over the range one to five
    When the verdict is read
    Then the score is 2.26

  @unit
  Scenario: A category verdict is the most likely option and its probability
    Given a classifier answering a distribution over three options
    When the verdict is read
    Then the label is the most likely option
    And the full distribution is kept

  @unit
  Scenario: Answers are matched to questions by id rather than by order
    Given a classifier that answers in a different order than it was asked
    When the verdicts are read
    Then each verdict belongs to the question that asked it

  # ---------------------------------------------------------------------------
  # The token budget
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The text budget is what is left of the state cap after the questions
    Given three questions estimated at 400 tokens
    When the text budget is computed
    Then it is the state cap less the questions and less the reserve

  @unit
  Scenario: A text past its budget is cut rather than refused
    Given a text estimated at twice its budget
    When it is prepared for the classifier
    Then it is cut to the budget on a character boundary
    And the verdict records that the text was cut

  @unit
  Scenario: A question list that leaves no room for text is refused before it is sent
    Given questions that alone exceed the state cap
    When the text budget is computed
    Then it is refused rather than sent with an empty text

  # ---------------------------------------------------------------------------
  # Pricing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Cost is the input tokens at the published rate, and output is free
    Given a response reporting one million input tokens and two hundred thousand output tokens
    When the cost is computed
    Then it is the published rate for one million tokens

  @unit
  Scenario: The customer price carries the platform markup
    Given a classifier cost
    When the price is computed
    Then it is the cost times the markup

  # ---------------------------------------------------------------------------
  # Transport, retries and refusals
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A rate-limited request waits the interval the classifier asked for
    Given a classifier answering 429 with a Retry-After of two seconds, then answering
    When a question is asked
    Then the second attempt is made after two seconds
    And the verdict comes back

  @unit
  Scenario: A Retry-After longer than the cap waits the cap instead
    Given a classifier answering 429 with a Retry-After of five minutes
    When a question is asked
    Then the wait is capped

  @unit
  Scenario: A request gives up after the fifth attempt
    Given a classifier answering 429 to every attempt
    When a question is asked
    Then five attempts are made
    And the row is skipped with the rate-limited reason

  @unit
  Scenario: A text the classifier refuses as too large is cut once and retried
    Given a classifier refusing the text as past its token cap, then answering
    When a question is asked
    Then the text is sent again at three quarters of its length
    And the verdict comes back

  @unit
  Scenario: A text refused twice as too large is skipped rather than cut again
    Given a classifier refusing the text as past its token cap twice
    When a question is asked
    Then the row is skipped with the input-too-large reason

  @unit
  Scenario: A refusal that is not retryable is not retried
    Given a classifier answering 401
    When a question is asked
    Then one attempt is made
    And the failure is reported as the classifier being unavailable

  @unit
  Scenario: The null classifier answers every question as skipped
    Given a deployment with no classifier key
    When a question is asked
    Then every verdict is skipped
    And nothing is sent over the network

  # ---------------------------------------------------------------------------
  # The global limiter
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Permits are taken from one bucket shared by every pod
    Given a bucket with capacity for two hundred requests
    When two callers ask for permits at once
    Then the bucket is decremented once per permit granted

  @unit
  Scenario: An empty bucket refills at the configured rate
    Given an empty bucket refilling at one hundred a second
    When half a second passes
    Then fifty permits are available

  @unit
  Scenario: The bucket never fills past its capacity
    Given an idle bucket
    When a long time passes
    Then at most its capacity is available

  @unit
  Scenario: A Redis that cannot be reached falls back to a local rate
    Given Redis refusing every call
    When permits are asked for
    Then they are granted at the local fallback rate
    And the query still runs
