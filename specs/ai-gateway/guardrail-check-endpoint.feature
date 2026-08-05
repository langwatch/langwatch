Feature: The control plane evaluates guardrails for the gateway

  The Go data plane calls POST /api/internal/gateway/guardrail/check once per
  direction per request. The control plane runs the evaluators bound to the
  guardrails the virtual key references and returns a single aggregated verdict.

  The wire shape is fixed by contract.md 4.6. Both sides must agree on it, and a
  disagreement must fail loudly rather than quietly allowing traffic through.

  See specs/ai-gateway/_shared/contract.md 4.6 and 7b.
  Data-plane behaviour on receiving a verdict lives in guardrails.feature.

  Background:
    Given a project with an evaluator bound to an enabled AS_GUARDRAIL monitor
    And a gateway guardrail "pii-detector" on that evaluator in the request direction

  Rule: The request and response wire shapes are the ones in the contract

    @integration
    Scenario: the endpoint accepts the directions the gateway actually sends
      When the gateway posts a check with direction "request"
      Then the endpoint accepts it
      And the verdict names a decision of "allow", "block" or "modify"

    @integration
    Scenario Outline: every contract direction is accepted
      When the gateway posts a check with direction "<direction>"
      Then the endpoint accepts it

      Examples:
        | direction    |
        | request      |
        | response     |
        | stream_chunk |

    @integration
    Scenario: a direction outside the contract is rejected
      When the gateway posts a check with direction "sideways"
      Then the endpoint responds 400 with code "validation_error"

    @integration
    Scenario: the verdict field is named decision, not action
      When the gateway posts a check that a guardrail blocks
      Then the response body has a "decision" field equal to "block"
      And the response body has "reason" and "policies_triggered" fields

    @unit
    Scenario: the data plane and the control plane agree on the wire shape
      Given the Go client's guardrail response struct
      And the control plane's guardrail response schema
      Then both name the verdict field "decision"
      And both accept the same decision values
      # A mismatch here silently allows every request, because an unknown
      # verdict falls through to the allow default. Pin it with a test on
      # both sides rather than trusting review.

  Rule: A blocked guardrail actually blocks the request

    @integration
    Scenario: an evaluator that fails the content blocks the request
      Given the bound evaluator returns passed=false with details "PII detected: email"
      When the gateway posts a request-direction check
      Then the decision is "block"
      And the reason is "PII detected: email"
      And policies_triggered names the guardrail

    @integration
    Scenario: an evaluator that passes allows the request
      Given the bound evaluator returns passed=true
      When the gateway posts a request-direction check
      Then the decision is "allow"

    @integration
    Scenario: a skipped evaluator does not block
      Given the bound evaluator returns status "skipped"
      When the gateway posts a request-direction check
      Then the decision is "allow"

  Rule: Failure mode decides what an evaluator error means

    @integration
    Scenario: a fail-closed guardrail blocks when its evaluator errors
      Given the guardrail's failure mode is FAIL_CLOSED
      And the bound evaluator returns status "error"
      When the gateway posts a request-direction check
      Then the decision is "block"
      And the reason explains that the guardrail could not be evaluated

    @integration
    Scenario: a fail-open guardrail allows when its evaluator errors
      Given the guardrail's failure mode is FAIL_OPEN
      And the bound evaluator returns status "error"
      When the gateway posts a request-direction check
      Then the decision is "allow"

  Rule: Several guardrails aggregate into one verdict

    @integration
    Scenario: any blocking guardrail blocks the whole check
      Given two guardrails in the request direction
      And the first returns passed=true and the second returns passed=false
      When the gateway posts a request-direction check
      Then the decision is "block"
      And policies_triggered names only the guardrail that failed

    @integration
    Scenario: guardrails from another project are never evaluated
      Given a guardrail id belonging to a different project
      When the gateway posts a check naming that id
      Then that guardrail is not evaluated
      And the decision is "allow"

    @integration
    Scenario: an archived guardrail is not evaluated
      Given the guardrail is archived
      When the gateway posts a request-direction check
      Then that guardrail is not evaluated

  Rule: The data plane fails closed unless the key opts out

    @unit
    Scenario: the check endpoint being unreachable blocks by default
      Given the control plane cannot be reached
      And the virtual key has not opted into fail-open for the request direction
      When the data plane evaluates request-direction guardrails
      Then the request is blocked
      # Guardrails that silently stop enforcing when the control plane is down
      # are worse than no guardrails, because the UI still shows them as on.

    @unit
    Scenario: a key that opted into fail-open passes traffic through
      Given the control plane cannot be reached
      And the virtual key has opted into fail-open for the request direction
      When the data plane evaluates request-direction guardrails
      Then the request proceeds
      And the degradation is recorded on the span
