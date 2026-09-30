Feature: Evaluators ported to the Go runtime answer as langevals answered
  Each port replays langevals' recorded answers (services/nlpgo/modules/evaluators/testdata)
  and matches them before its evaluator may be switched to Go. Vendor and embeddings
  evaluators call out with the tenant's own credentials only.
  Plan: dev/docs/plans/langevals-go-replacement.md §8, §11 Phase 2.

  @unit
  Scenario: The rule-based langevals evaluators answer as langevals answered
    Given langevals' recorded answers for basic, competitor_blocklist and valid_format
    When the Go runtime evaluates the same entries with the same settings
    Then every status, score, passed and label matches
    And details match, up to the exception text Python wrote itself

  @unit
  Scenario: A valid_format mode short of parity is reported, not hidden
    Given langevals' recorded valid_format answers for python and sql
    When the Go runtime evaluates them
    Then the cases that differ are listed by name in the test output

  @unit
  Scenario: The ragas text metrics score as langevals scored
    Given langevals' recorded answers for bleu, rouge and the non-LLM context metrics
    When the Go runtime evaluates the same entries with the same settings
    Then every score matches within 1e-9

  @unit @unimplemented
  Scenario: A moderation or content safety call uses only the tenant's own key
    Given the runtime's own process environment holds a vendor key
    And the request carries a different tenant key
    When the tenant runs a vendor evaluator
    Then the vendor receives the tenant's key and never the runtime's

  @unit @unimplemented
  Scenario: A vendor evaluator without a tenant key does not call the vendor
    Given the request carries no key for the vendor
    When the tenant runs a vendor evaluator
    Then the vendor is not called
    And the entry's result says the vendor is not configured

  @unit @unimplemented
  Scenario: A vendor endpoint at a private address is refused
    Given the request names a content safety endpoint on the internal network
    When the tenant runs a content safety evaluator
    Then no connection is made
    And the entry's result is an error

  @unit @unimplemented
  Scenario: A vendor failure is an entry error, not a server error
    Given the vendor answers with a server error
    When the tenant runs a vendor evaluator
    Then the entry's result is an error
    And the response is not a server error

  @unit @unimplemented
  Scenario: Embeddings evaluators use the tenant's embeddings credentials
    Given the request carries embeddings credentials that differ from its chat credentials
    When the tenant runs the similarity or sentiment evaluator
    Then every embeddings call uses the embeddings credentials
