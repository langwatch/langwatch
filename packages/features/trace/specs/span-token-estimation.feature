Feature: Estimating token counts for LLM spans that arrived without them

  An SDK that reports no usage tokens leaves every cost and every token panel
  blank for that span. Where the span carries the text, the counts can be
  derived from it — but only where they are genuinely absent, and only while
  two kill switches allow it, because an estimate stamped over a provider's own
  count is worse than no estimate at all.

  This runs on the ingest path, so a process composed from packages must be
  able to count tokens without the application. The counting itself is a vendor
  encoding table behind a port; everything above it — which spans qualify,
  which text is counted, and what is written back — belongs to the feature.

  @unit
  Scenario: Only an LLM span is estimated
    Given a span that is not marked as an LLM span
    When the estimator runs
    Then the span is left exactly as it arrived

  @unit
  Scenario: A span that already reports both counts is left alone
    Given an LLM span carrying input and output token attributes
    When the estimator runs
    Then no tokenizer call is made

  @unit
  Scenario: Only the missing side is estimated
    Given an LLM span reporting input tokens but not output tokens
    When the estimator runs
    Then only the output count is added

  @unit
  Scenario: An estimated span is marked as estimated
    Given an LLM span with text and no token counts
    When the estimator adds a count
    Then the span also carries the estimated marker

  @unit
  Scenario: A tokenizer that cannot count leaves the span untouched
    Given a tokenizer that answers nothing for the span's model
    When the estimator runs
    Then no attribute is added and no marker is stamped

  @unit
  Scenario: Either kill switch stops estimation
    Given the global or the per-project kill switch is on
    When the estimator runs
    Then no tokenizer call is made

  @unit
  Scenario: The tokenizer's local BPE directory is preferred over the network
    Given a process configured with a local BPE directory holding the file
    When an encoding is loaded
    Then the file is read from disk and no remote fetch is made

  @unit
  Scenario: A remote BPE fetch cannot hang the process
    Given a remote BPE fetch that never settles
    When the configured timeout elapses
    Then the fetch is aborted and the span is left unestimated

  @unit
  Scenario: The two tokenizer variables are read at the application's spellings
    Given a deployment setting the tokenizer path and fetch timeout
    When the process resolves its configuration
    Then both are read under the names the application reads them under

  @unit
  Scenario: An unparseable fetch timeout falls back rather than refusing to boot
    Given a fetch timeout that is not a positive number
    When the process resolves its configuration
    Then the application's default is used
