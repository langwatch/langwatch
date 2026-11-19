# See dev/docs/adr/203-private-model-endpoints-staff-own-addresses-customers-own-names.md
# for why staff own the addresses and customers own the names.
Feature: Private model endpoints for one organization
  As a customer whose model gateway has no public endpoint
  I want to point my own hostnames at the private endpoint LangWatch set up for me
  So that I can use that gateway as a model provider without a support ticket per change
  while no other tenant can reach it, and no tenant can reach LangWatch's own network

  Staff register a private endpoint for one organization: its exact addresses
  and one port. The organization binds hostnames to it. A model call to a bound
  hostname dials the registered addresses directly and never resolves the name.
  A host that is not bound keeps the rules in ssrf-blocking.feature.

  Paths covered: the credential check on save, model discovery, the nlpgo
  playground proxy, nlpgo workflow LLM blocks and the evaluators nlpgo runs
  itself, AI gateway virtual keys, and the model calls langevals makes for
  evaluators and topic clustering, which go through nlpgo's proxy. In the
  scenarios, "a model call" means each of these paths. The AI gateway picks up
  a binding change on the next bundle revalidation, not on the next call; the
  other paths pick it up on the next call. The gaps are listed under "Paths
  that do not honour bindings yet".

  The app sends nlpgo the organization's bindings only in the
  X-LangWatch-Private-Endpoints header: an Ed25519-signed envelope naming the
  organization, the project and an expiry. nlpgo never reads bindings from a
  request body.

  Background:
    Given BLOCK_LOCAL_HTTP_CALLS is "true"
    And REQUIRE_HTTPS_CUSTOM_ENDPOINTS is "true"
    And staff registered private endpoint "Inference" for organization "Acme" with:
      | addresses | 10.20.1.21, 10.20.2.34 |
      | port      | 443                  |
    And "Acme" bound "llm.internal.acme.test" to "Inference"
    And project "acme-prod" belongs to "Acme"

  # ============================================================================
  # Golden path
  # ============================================================================

  Rule: A bound hostname reaches the organization's own private endpoint

    @integration
    Scenario Outline: <path> reaches the private endpoint through a bound hostname
      Given "acme-prod" has a custom OpenAI-compatible provider with base URL "https://llm.internal.acme.test/v1"
      When <path> runs for "acme-prod"
      Then the call connects to 10.20.1.21 or 10.20.2.34 on port 443
      And the TLS handshake uses the server name "llm.internal.acme.test"
      And the certificate is verified for "llm.internal.acme.test"

      Examples:
        | path                              |
        | the credential check on save      |
        | model discovery                   |
        | the nlpgo playground proxy        |
        | an nlpgo workflow LLM block       |
        | an nlpgo evaluator block          |
        | an AI gateway virtual-key request |

    @unit
    Scenario: A silent address does not hold up the next one
      Given 10.20.1.21 never answers
      When a model call runs for "acme-prod" with base URL "https://llm.internal.acme.test/v1"
      Then the attempt on 10.20.1.21 gives up after 3 seconds
      And the call connects to 10.20.2.34
      And the call's overall connect timeout is unchanged

    @unit
    Scenario: A bound hostname is never resolved
      Given public DNS answers 203.0.113.10 for "llm.internal.acme.test"
      When a model call runs for "acme-prod" with base URL "https://llm.internal.acme.test/v1"
      Then no DNS lookup is made for "llm.internal.acme.test"
      And the call connects to 10.20.1.21 or 10.20.2.34

    @unit
    Scenario: The second address is tried when the first refuses
      Given 10.20.1.21 refuses connections
      When a model call runs for "acme-prod" with base URL "https://llm.internal.acme.test/v1"
      Then the call connects to 10.20.2.34

  # ============================================================================
  # Tenant boundary
  # ============================================================================

  Rule: A binding admits only its own organization

    @integration
    Scenario: Another organization cannot use Acme's binding
      Given project "rival-prod" belongs to organization "Rival"
      And "Rival" has no private endpoint
      And "rival-prod" has a custom provider with base URL "https://llm.internal.acme.test/v1"
      When a model call runs for "rival-prod"
      Then the hostname is resolved as usual
      And a private answer is refused as a private address

    @integration
    Scenario: Two organizations bind the same hostname to their own endpoints
      Given staff registered private endpoint "Gateway" for "Rival" with address 10.20.3.5
      And "Rival" bound "llm.internal.acme.test" to "Gateway"
      When a model call runs for a project in "Rival" with base URL "https://llm.internal.acme.test/v1"
      Then the call connects to 10.20.3.5
      And never to 10.20.1.21 or 10.20.2.34

  # ============================================================================
  # What a binding cannot do
  # ============================================================================

  Rule: A binding never widens what a call can reach

    @unit
    Scenario: A binding carrying an address outside the private ranges is refused
      Given a binding for "llm.internal.acme.test" carries 10.20.1.21 and 127.0.0.1
      When a model call runs for "acme-prod" with base URL "https://llm.internal.acme.test/v1"
      Then the call is refused
      And no connection is opened, not even to 10.20.1.21

    @unit
    Scenario: Bindings never apply to LangWatch's own credentials
      Given an AI gateway bundle for "acme-prod" holds a platform credential and a LangWatch provider
      When the gateway reads the bundle
      Then only the organization's own credentials carry the bindings

    @unit
    Scenario: An IP-literal base URL is never treated as bound
      When a model call runs for "acme-prod" with base URL "https://10.20.1.21/v1"
      Then the call is refused as a private address

    @unit
    Scenario Outline: <url> is refused for a bound hostname
      When a model call runs for "acme-prod" with base URL "<url>"
      Then the call is refused
      And no connection is opened

      Examples:
        | url                                        |
        | http://llm.internal.acme.test/v1       |
        | https://llm.internal.acme.test:8443/v1 |

    @unit
    Scenario: A refusal does not reveal the registered addresses
      When a model call for "acme-prod" to "https://llm.internal.acme.test:8443/v1" is refused
      Then the error names the hostname and the port
      And the error does not contain 10.20.1.21 or 10.20.2.34

  # ============================================================================
  # How bindings reach nlpgo
  # ============================================================================

  Rule: nlpgo takes bindings only from an envelope the app signed

    @unit
    Scenario: The app's signed envelope verifies in nlpgo byte for byte
      Given the app signs Acme's bindings for "acme-prod"
      Then the header is the one nlpgo's verifier is tested against

    @unit
    Scenario: nlpgo accepts bindings only in an envelope signed for the request's project
      Given nlpgo holds LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY
      When a request for "acme-prod" carries Acme's envelope signed for "acme-prod"
      Then the call runs under Acme's bindings

    @unit
    Scenario Outline: nlpgo refuses <envelope> with a 400 and never falls back to DNS
      Given nlpgo holds LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY
      When a request for "acme-prod" carries <envelope>
      Then nlpgo answers 400 with reason "invalid_private_endpoints"
      And nothing runs
      And the answer does not contain 10.20.1.21 or 10.20.2.34

      Examples:
        | envelope                              |
        | an envelope with a forged signature   |
        | an expired envelope                   |
        | an envelope signed for "rival-prod"   |
        | an envelope with no project to match  |
        | an unsigned binding list              |

    @unit
    Scenario: A private_endpoints field in a workflow body is ignored
      When a workflow request for "acme-prod" carries a private_endpoints field in its body
      Then the workflow runs with no bindings
      And this holds with the internal secret too

    @unit
    Scenario: Without a verify key nlpgo accepts no bindings
      Given nlpgo holds no LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY
      When a request carries a valid envelope
      Then the call runs with no bindings
      And nlpgo logs a warning

    @unit
    Scenario: A project's studio Lambda accepts signed bindings without the internal secret
      Given a project's studio Lambda holds the verify key and no internal secret
      When a request carries Acme's envelope signed for that project
      Then the call runs under Acme's bindings

    @unit
    Scenario: A project's studio Lambda checks bindings against the public key alone
      When the app creates or reconciles a project's studio Lambda
      Then its environment carries LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY
      And never the signing key or the internal secret

    @integration
    Scenario: A relayed workflow turn cannot choose its own bindings
      Given a caller with a project key posts to "/api/scenario/execute-sync"
      When the body or the headers carry their own private endpoints
      Then the engine receives none of them
      And the engine receives only the organization's envelope, on the HTTP and the Lambda route

  # ============================================================================
  # Model calls other services make for the app
  # ============================================================================

  Rule: langevals never dials a bound hostname itself

    langevals runs litellm, which resolves names through DNS. A call to a bound
    host goes through nlpgo's proxy instead, with the signed envelope, and
    nlpgo verifies it and dials the registered addresses.

    @unit
    Scenario: A langevals model call to a bound hostname goes through nlpgo
      Given "acme-prod" has a custom provider with base URL "https://llm.internal.acme.test/v1"
      When an LLM-as-judge evaluator runs for "acme-prod" in langevals
      Then langevals calls nlpgo's proxy, not "llm.internal.acme.test"
      And the call carries the provider's own parameters and Acme's envelope signed for "acme-prod"

    @unit
    Scenario: Topic clustering's model calls to a bound hostname go through nlpgo
      Given "acme-prod" clusters topics with a model on "https://llm.internal.acme.test/v1"
      When a clustering page runs for "acme-prod"
      Then the naming call goes to nlpgo's proxy with Acme's envelope
      And an embeddings call to an unbound host goes straight to its provider

    @unit
    Scenario: A langevals model call to an unbound host keeps its route
      When an evaluator for "acme-prod" calls a model on "https://api.example.com/v1"
      Then langevals calls "https://api.example.com/v1" with exactly the parameters it had before

    @unit
    Scenario: The engine credential reaches langevals in a header, never in the body
      When the app posts an evaluation whose model call goes through nlpgo
      Then the internal secret and the proxy URL are request headers
      And the body, which may be staged in a customer's bucket, holds neither

    @unit
    Scenario: langevals sends the engine credential only to the engine proxy
      Given the app named nlpgo's proxy and the internal secret in the request headers
      When a model call in that request goes anywhere else
      Then the call carries no internal secret

    @unit
    Scenario: An agent test turn carries the organization's signed bindings
      When an agent test turn for a workflow agent in "acme-prod" posts straight to nlpgo
      Then it carries Acme's envelope signed for "acme-prod"
      And a turn sent through the relay carries none, because the relay signs its own

  # ============================================================================
  # Customers manage bindings
  # ============================================================================

  Rule: Organization managers bind hostnames themselves

    @integration
    Scenario: An organization manager binds a hostname
      Given I hold "organization:manage" in "Acme"
      When I bind "llm.acme.test" to "Inference" in organization settings
      Then the binding is saved for "Acme"
      And the change is recorded in the audit log with my identity
      And the next model call for "acme-prod" to "https://llm.acme.test/v1" connects to 10.20.1.21 or 10.20.2.34
      And an AI gateway virtual key uses the binding from its next bundle revalidation

    @integration
    Scenario: The settings page shows endpoints without their addresses
      Given I hold "organization:manage" in "Acme"
      When I open private endpoints in organization settings
      Then I see "Inference" with its region, status and bound hostnames
      And I do not see 10.20.1.21 or 10.20.2.34

    @integration
    Scenario: A member without organization:manage cannot change bindings
      Given I am a member of "Acme" without "organization:manage"
      When I try to bind "llm.acme.test" to "Inference"
      Then the request is refused as forbidden

    @integration
    Scenario: A customer cannot bind to another organization's endpoint
      Given staff registered private endpoint "Gateway" for "Rival"
      And I hold "organization:manage" in "Acme"
      When I try to bind "llm.acme.test" to "Gateway"
      Then the request is refused as not found

    @unit
    Scenario: The binding API has no way to set an address
      When I bind "llm.acme.test" to "Inference" with an extra field "addresses" of "10.20.9.9"
      Then the request is refused as invalid
      And "Inference" keeps addresses 10.20.1.21 and 10.20.2.34

    @unit
    Scenario Outline: An invalid hostname is refused
      When I bind "<hostname>" to "Inference"
      Then the binding is not saved
      And the error says why

      Examples:
        | hostname       |
        | 10.20.1.21      |
        | [fd00::1]      |
        | *.acme.test    |
        | localhost      |
        | acme           |
        | langwatch.ai   |
        | app.langwatch.ai |

    @unit
    Scenario: Two concurrent binds of one hostname save one binding
      When two organization managers bind "race.acme.test" at the same moment
      Then one binding is saved
      And the other is refused on the hostname field as already bound

    @integration
    Scenario: Removing a binding closes the path for the next call
      When an organization manager removes the binding for "llm.internal.acme.test"
      Then the next model call for "acme-prod" to that hostname is resolved as usual
      And a private answer is refused as a private address
      And an AI gateway virtual key stops using the binding from its next bundle revalidation

  # ============================================================================
  # Staff manage private endpoints
  # ============================================================================

  Rule: Only staff with ops:manage manage private endpoints

    @integration
    Scenario: Staff register a private endpoint in ops
      Given I hold the "ops:manage" platform permission
      When I register private endpoint "Inference" for "Acme" with addresses "10.20.1.21, 10.20.2.34", port 443 and region "eu-west-1"
      Then the private endpoint is saved for "Acme"
      And the change is recorded in the audit log with my identity

    @integration
    Scenario: A customer cannot create or change a private endpoint
      Given I hold "organization:manage" in "Acme" without platform permissions
      When I try to register a private endpoint for "Acme"
      Then the request is refused as forbidden

    @unit
    Scenario Outline: Ops refuses an invalid address or port
      When I register a private endpoint with <field> "<value>"
      Then the private endpoint is not saved
      And the error names <field>

      Examples:
        | field     | value           |
        | addresses | 10.20.1.0/24     |
        | addresses | 8.8.8.8         |
        | addresses | 127.0.0.1       |
        | addresses | 169.254.169.254 |
        | addresses | fd00:ec2::254   |
        | port      | 0               |
        | port      | 70000           |

    @unit
    Scenario Outline: Ops accepts an address in each private range the dial admits
      When I register a private endpoint with addresses "<address>"
      Then the address is saved

      Examples:
        | address        |
        | 10.0.0.1       |
        | 172.31.255.254 |
        | 192.168.1.1    |
        | 100.64.0.1     |
        | fd00::1        |

    @integration
    Scenario: Removing a private endpoint closes every binding to it
      When staff remove private endpoint "Inference"
      Then "Acme" has no binding for "llm.internal.acme.test"
      And the next model call for "acme-prod" to that hostname is resolved as usual

  # ============================================================================
  # Unchanged paths
  # ============================================================================

  Rule: A binding authorizes model calls, not arbitrary HTTP

    @unit
    Scenario Outline: <path> ignores bindings
      When <path> for "acme-prod" targets "https://llm.internal.acme.test/"
      Then the hostname is resolved as usual
      And a private answer is refused as a private address

      Examples:
        | path                         |
        | a workflow HTTP block        |
        | a webhook automation         |
        | a scenario HTTP agent target |

  Rule: Paths that do not honour bindings yet

    @unimplemented
    Scenario Outline: <path> does not honour bindings yet
      Given "acme-prod" has a provider whose endpoint host "llm.internal.acme.test" is bound
      When <path> runs for "acme-prod"
      Then the call never reaches the private endpoint

      Examples:
        | path                         |
        | an Azure OpenAI provider     |
        | a Bedrock provider           |
        | the LangWatch provider       |
        | a realtime (voice) session   |
        | a Codex coding-agent run     |
        | Voyage embeddings            |

  Rule: Installs that allow private calls see no change

    @unit
    Scenario: With BLOCK_LOCAL_HTTP_CALLS false, an unbound private host is allowed
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When a model call for a project in "Rival" targets "https://10.0.5.3/v1"
      Then the call is allowed
