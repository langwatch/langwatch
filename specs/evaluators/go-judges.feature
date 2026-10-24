Feature: The langevals judges answer on the Go runtime as langevals answered
  The LLM-as-judge evaluators replay langevals' recorded model calls
  (services/nlpgo/modules/evaluators/testdata) with every rendered request
  compared, and keep litellm_patch.py's provider behaviors.
  Plan: dev/docs/plans/langevals-go-replacement.md §8.2, §8.4.

  @unit
  Scenario: Each langevals judge replays its recorded answers, requests included
    Given langevals' recorded calls and answers for llm_boolean, llm_score, llm_category, llm_answer_match, competitor_llm, competitor_llm_function_call, off_topic and query_resolution
    When the Go runtime evaluates the same entries with the same settings
    Then every request it sends matches a recorded one, prompts byte for byte
    And every recorded call is made
    And each result has the recorded status, score, passed, label and details

  @unit
  Scenario: A refused forced tool call is retried with a reminder, as langevals does
    Given a judge model that refuses a forced tool_choice, or calls the function without a required field
    When a judge evaluates an entry
    Then the refused call is retried with tool_choice "auto", then once more with a reminder naming the function and its required fields
    And a call that left a field out is retried once with the reminder
    And an answer that never calls the function is the entry error JudgeAnswerError naming the model

  @unit
  Scenario: GPT-5 judges run at temperature 1 and Anthropic judges without top_p
    Given a judge on a gpt-5 model with a temperature of 0 in the tenant's settings
    And a judge on a Claude model with both a temperature and a top_p in the tenant's settings
    When each evaluates an entry
    Then the gpt-5 call is sent at temperature 1
    And the Claude call is sent with the temperature and without top_p

  @unit
  Scenario: Content over the token budget is cut keeping both ends, and the details say so
    Given an entry whose output is longer than the judge's max tokens
    When a judge evaluates it
    Then the output is sent with its opening and ending and a marker naming the tokens left out
    And the result details end with how many tokens were omitted to fit the maximum

  @unit
  Scenario: A judge prompt that leaves no room for content is skipped with the numbers
    Given a judge whose own prompt takes nearly all of its max tokens
    When it evaluates an entry
    Then no model call is made
    And the entry is skipped with the prompt's token count and the maximum

  @unit
  Scenario: An unset max tokens budgets the judge at 128000 and sends none to the provider
    Given an LLM judge whose max tokens is not set, null or 0
    When it evaluates an entry
    Then the content is fitted to a budget of 128000 tokens, held to the model's input window
    And the model call carries no max tokens, so the provider's own default applies
    And a max tokens the platform sends with the tenant's model settings still goes to the provider

  # langevals/llm_score's min and max are read by the platform, never by the judge.
  @unit
  Scenario: The score judge takes a min and max and keeps the model's score as given
    Given a score judge whose settings ask for a score between 1 and 5
    When the model answers with a score of 7
    Then the result's score is 7, not clamped to the range
    And the prompt sent is the settings' prompt alone, with nothing added for the range
    And a min or max that is not a number is refused as a wrong-typed setting

  @unit
  Scenario: Judge prompts and entry content never reach a log or a LangWatch span
    Given judges that answer, and judges whose answer cannot be read
    When they evaluate entries
    Then no log line and no LangWatch operations span carries the prompt, the entry content or the model's reasoning
    And the failure is still named by its error type
