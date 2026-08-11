Feature: Azure deployment resolution on the control-plane / virtual-key dispatch path
  As a customer whose Azure OpenAI provider is configured in LangWatch and used
  through a virtual key
  I want every gateway request for my Azure model to resolve its deployment
  So that my calls reach Azure instead of failing before a request leaves the box,
  and so that when a configuration IS genuinely wrong I am told it is a
  configuration error rather than a retryable timeout.

  Context (langwatch-saas#1016). Two independent defects.

  Defect A: the control-plane / virtual-key path materialises provider slots into
  credentials without ever applying the deployment self-map. A slot that arrives
  with no wire-level deployment_map yields a credential with a nil deployment map,
  which Bifrost's Azure adapter rejects with the literal "deployments not set"
  before any network call. Three non-test self-map call sites exist today, all in
  services/nlpgo; zero in services/aigateway. This is the third dispatch path to
  ship with the call missing (#5760 was the second), so the contract below is a
  single chokepoint whose omission is a build error, not a runtime failure.

  Defect B: a Bifrost error carrying no status code is classified as a timeout,
  so a permanent configuration failure is surfaced to clients as HTTP 504 and is
  retried through the whole credential fallback chain on every request.

  Background:
    Given a project with an Azure OpenAI provider slot on a virtual key
    And the slot's resource endpoint and API key are correct

  # --- A. Capability: Azure dispatch works on the control-plane / VK path ---

  @integration
  Scenario: A slot with no deployment_map on the wire still resolves a deployment
    Given the provider slot carries no deployment_map field
    When a chat completion for the Azure model is dispatched through the virtual-key path
    Then the key handed to the provider carries a non-empty Azure deployments map keyed on the dispatched model
    And the dispatch is not rejected with "deployments not set"

  @unit
  Scenario: An empty deployment_map is treated the same as an absent one
    Given the provider slot carries a deployment_map that is present but empty
    When the credential for that slot is built
    Then it carries the same deployments map as a slot with no deployment_map field

  # Not enforced: this asserts a property of the pre-fix tree, which no test
  # living in the post-fix tree can hold. Discharged as red-before-green
  # evidence on the pull request instead.
  @integration @unimplemented
  Scenario: The dispatch fails on a tree without the fix
    Given the deployment self-map is not applied on the control-plane path
    When a chat completion for the Azure model is dispatched through the virtual-key path
    Then the dispatch is rejected with "deployments not set"

  # --- B. Key form: the map key must match the lookup key ---

  @unit
  Scenario: The deployment-map key equals the model string placed on the provider request
    Given an Azure slot with no deployment_map
    When the credential and the provider request are built from the same dispatch
    Then looking the provider request's model up in the deployments map returns a non-empty deployment

  @integration
  Scenario: A resolved model dispatches on its bare model id
    Given the request carries a resolved model whose model id is bare and whose provider is Azure
    And the request's model string carries the provider prefix
    When a chat completion is dispatched
    Then the provider request's model is the bare model id
    And the deployments map maps that bare model id to itself

  @unit
  Scenario: An unresolved model keeps request model and map key identical
    Given the request carries no resolved model and its model string carries the provider prefix
    When the credential and the provider request are built
    Then the deployments map key and the provider request's model are the same value

  # --- C. Existing configuration is preserved ---

  @unit
  Scenario: A configured deployment_map reaches the provider verbatim
    Given the provider slot maps a model to a custom deployment name
    When the credential for that slot is built
    Then that mapping is present unchanged and no entry is overwritten

  @unit
  Scenario Outline: Deployment precedence is wire mapping, then explicit deployment, then the model id
    Given the slot's wire mapping for the requested model is <wire>
    And the slot's explicit deployment setting is <explicit>
    When the credential for that slot is built
    Then the deployment resolved for the requested model is <result>

    Examples:
      | wire     | explicit  | result   |
      | wire-dep | extra-dep | wire-dep |
      | none     | extra-dep | extra-dep|
      | none     | none      | the requested model id |

  # --- D. Provider and dispatch-lane coverage ---

  @unit
  Scenario Outline: Deployment-mapped providers all receive the self-map on this path
    Given a <provider> provider slot with no deployment_map on the control-plane path
    When the credential for that slot is built
    Then it carries a non-empty deployments map keyed on the dispatched model

    Examples:
      | provider |
      | azure    |
      | bedrock  |
      | vertex   |

  @unit
  Scenario Outline: Providers without deployments are left untouched
    Given a <provider> provider slot on the control-plane path
    When the credential for that slot is built
    Then its deployment map is still nil
    And no Azure key configuration is fabricated for it

    Examples:
      | provider  |
      | openai    |
      | anthropic |

  @integration
  Scenario Outline: Every dispatch lane resolves the deployment, not only chat
    Given an Azure slot with no deployment_map
    When a <lane> request for the Azure model is dispatched through the virtual-key path
    Then the key handed to the provider carries a non-empty deployments map keyed on the dispatched model

    Examples:
      | lane                        |
      | chat completion             |
      | streaming chat completion   |
      | responses                   |
      | embeddings                  |
      | translated messages         |
      | audio speech                |
      | audio transcription         |

  # --- E. Non-recurrence: a fourth dispatch path cannot ship without the call ---

  @unit
  Scenario: Credential construction passes through exactly one deployment chokepoint
    Given the aigateway service after the fix
    When its non-test deployment self-map call sites are enumerated
    Then there is exactly one

  # Not enforced: untrue as written on this tree. deploymentMapModelIDs in
  # adapters/providers/models_discovery.go reads a credential's deployment map
  # on the ListModels path, and that credential is not produced by the
  # chokepoint. Left unasserted rather than weakened to whatever passes; the
  # gap is reported with this change.
  @integration @unimplemented
  Scenario: Every consumer of a deployment map is fed by that chokepoint
    Given the non-test code paths that read a credential's deployment map, including the Bedrock VPCE lane that bypasses key construction
    When each is traced back to the credential it consumes
    Then each one receives a credential produced by the single chokepoint

  # Not enforced: the claim is that a mutated tree fails to compile, which a
  # test compiled as part of that tree cannot make. The chokepoint's call-site
  # count is the enforceable half and is held by AC12.
  @unit @unimplemented
  Scenario: A dispatch path that omits the requested model does not build
    Given a dispatch call site with the requested-model argument removed
    When the aigateway service is compiled
    Then compilation fails with a missing-argument error rather than succeeding

  # --- F. Documentation correctness ---

  @unit
  Scenario: The self-map helper's documented invariant is true after the fix
    Given the deployment self-map helper's doc comment
    When it is read
    Then it no longer claims that every dispatch path shares the helper without naming the control-plane path
    And it names the control-plane / virtual-key path

  # --- G. Defect B: a status-less configuration error is not a timeout ---

  @unit
  Scenario: A configuration error carrying no status code is not classified as a timeout
    Given a provider error with no status code and the message "deployments not set"
    When it is classified
    Then its domain code is not the provider-timeout code
    And the HTTP status surfaced to the client is 502

  @integration
  Scenario: A permanent configuration error is not retried
    Given a provider error with no status code and the message "deployments not set"
    When a dispatch fails with it
    Then the retry reason is non-retryable
    And the credential fallback chain is not walked
    And the circuit breaker for that credential records no failure

  @unit
  Scenario: A genuine provider timeout still classifies as a timeout
    Given an error built by the provider library's own timeout constructor
    When it is classified
    Then its domain code is the provider-timeout code
    And the HTTP status surfaced to the client is 504
    And the retry reason is timeout

  @unit
  Scenario Outline: The remaining status-less error shapes are classified deliberately
    Given an error built by the provider library's <constructor> constructor
    When it is classified
    Then it lands on a named domain code with a named HTTP status
    And that code is not the provider-timeout code

    Examples:
      | constructor            |
      | unsupported operation  |
      | operation failure      |

  @unit
  Scenario Outline: Errors carrying an explicit status keep their current classification
    Given a provider error with status code <status>
    When it is classified
    Then its domain code is <code> and the HTTP status surfaced to the client is <http>

    Examples:
      | status | code             | http |
      | 504    | provider_timeout | 504  |
      | 408    | provider_error   | 502  |
      | 429    | rate_limited     | 429  |
      | 500    | provider_error   | 502  |

  @integration
  Scenario: The operator can identify the cause from the response alone
    Given a dispatch that fails with a status-less "deployments not set" configuration error
    When the client receives the error response
    Then the response body still contains the underlying provider message

  # Not enforced here: two of the four surfaces are the generated cross-language
  # codes and the control-plane TypeScript app, neither reachable from a Go
  # test. The repository's own codegen and typecheck gates hold them.
  @integration @unimplemented
  Scenario: A newly introduced error code moves with all of its coupled surfaces
    Given the fix introduces a new domain error code
    When the change is complete
    Then the code has a registered HTTP status
    And regenerating the cross-language error codes produces no diff
    And the control-plane app typechecks with a customer-facing presentation entry for the code
    And the code is either relayed upstream or the decision not to relay it is stated

  # --- H. Regression surface ---

  # Not enforced: "deep-equal to the credential produced before the change"
  # compares two trees, and "no assertion was edited" is a property of the
  # diff. Both are review-time checks, not runtime ones.
  @integration @unimplemented
  Scenario: The existing nlpgo dispatch paths produce unchanged credentials
    Given the three existing non-test self-map call sites in the nlpgo service
    When a fixed Azure input and a fixed Bedrock input are run through each
    Then the resulting credential is deep-equal to the credential produced before the change
    And no assertion in those packages' tests was edited

  @unit
  Scenario: The self-map never mutates the caller's map
    Given a credential whose deployment map is supplied by the caller
    When the self-map is applied to it
    Then the caller's original map is unchanged

  # Not enforced: this is the build, vet and test gate itself. A test asserting
  # it would be asserting its own run.
  @integration @unimplemented
  Scenario: The repository builds, vets and tests clean
    Given the change is applied
    When the build, vet and test suites for the aigateway and nlpgo services are run
    Then all of them pass

  # --- I. Rollback / deploy coupling ---

  # Not enforced: a property of the revert and of the deploy, not of the code
  # at any single commit.
  @integration @unimplemented
  Scenario: The change is revertible as a plain code revert
    Given the change introduces no data or schema migration
    When a revert is required
    Then reverting the code is sufficient
    And if a new error code landed, the Go side and the generated cross-language presentation land and revert in the same deploy

# --- AC Coverage Map ---
# AC1:  "Slot with no wire deployment_map dispatches, no 'deployments not set'" -> Scenario: A slot with no deployment_map on the wire still resolves a deployment
# AC2:  "Empty {} deployment_map behaves identically to absent" -> Scenario: An empty deployment_map is treated the same as an absent one
# AC3:  "The proving command fails on the pre-fix tree (red-before-green)" -> Scenario: The dispatch fails on a tree without the fix
# AC4:  "Map key is byte-identical to the model on the provider request" -> Scenario: The deployment-map key equals the model string placed on the provider request
# AC5:  "Production path: resolved model, prefixed req.Model -> bare key" -> Scenario: A resolved model dispatches on its bare model id
# AC6:  "Fallback path: unresolved model -> key and request model still equal" -> Scenario: An unresolved model keeps request model and map key identical
# AC7:  "Non-empty wire deployment_map reaches the provider verbatim" -> Scenario: A configured deployment_map reaches the provider verbatim
# AC8:  "Three-way precedence: wire > Extra[deployment] > bare model" -> Scenario Outline: Deployment precedence is wire mapping, then explicit deployment, then the model id
# AC9:  "Bedrock and Vertex get the same treatment as Azure" -> Scenario Outline: Deployment-mapped providers all receive the self-map on this path
# AC10: "Non-mapped providers unchanged; nil stays nil" -> Scenario Outline: Providers without deployments are left untouched
# AC11: "Every lane, not just chat (7 request types)" -> Scenario Outline: Every dispatch lane resolves the deployment, not only chat
# AC12: "Exactly one non-test self-map call site in aigateway post-fix" -> Scenario: Credential construction passes through exactly one deployment chokepoint
# AC13: "Every deployment-map consumer, incl. the Bedrock VPCE lane, is fed by the chokepoint" -> Scenario: Every consumer of a deployment map is fed by that chokepoint
# AC14: "Omission is a build error, proven not asserted" -> Scenario: A dispatch path that omits the requested model does not build
# AC15: "Doc comment's 'every dispatch path shares this' claim is corrected" -> Scenario: The self-map helper's documented invariant is true after the fix
# AC16: "Status-less config error is not provider_timeout; surfaces 502" -> Scenario: A configuration error carrying no status code is not classified as a timeout
# AC17: "Status-less config error is non-retryable; no fallback walk, no breaker trip" -> Scenario: A permanent configuration error is not retried
# AC18: "Genuine vendor-constructed timeout still 504 / ReasonTimeout" -> Scenario: A genuine provider timeout still classifies as a timeout
# AC18b:"The other two status-less constructors are classified deliberately" -> Scenario Outline: The remaining status-less error shapes are classified deliberately
# AC19: "True baseline for 504 / 408 / 429 / 500" -> Scenario Outline: Errors carrying an explicit status keep their current classification
# AC20: "Client-visible body still carries the underlying provider message" -> Scenario: The operator can identify the cause from the response alone
# AC21: "New herr.Code moves all four coupled surfaces together (N/A if reused)" -> Scenario: A newly introduced error code moves with all of its coupled surfaces
# AC22: "Three existing nlpgo call sites produce deep-equal credentials" -> Scenario: The existing nlpgo dispatch paths produce unchanged credentials
# AC23: "Self-map copy-on-write invariant holds" -> Scenario: The self-map never mutates the caller's map
# AC24: "go build / go vet / go test pass" -> Scenario: The repository builds, vets and tests clean
# AC25: "Plain code revert; Go + generated TS land and revert together" -> Scenario: The change is revertible as a plain code revert
#
# Count: 26 AC items (AC1-AC25 plus AC18b) -> 26 scenarios. No AC unmapped.
#
# Enforcement: 19 scenarios are bound to Go tests. 7 carry @unimplemented, each
# with its reason stated inline above the scenario -- AC3 (asserts the pre-fix
# tree), AC13 (untrue on this tree: a discovery-path consumer bypasses the
# chokepoint), AC14 (a negative compile), AC21 (codegen and TypeScript
# surfaces), AC22 (compares two trees), AC24 (the test gate itself), AC25
# (revert and deploy coupling).
