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
  playground proxy, nlpgo workflow LLM and evaluator blocks, and AI gateway
  virtual keys. In the scenarios, "a model call" means each of these paths.

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

    @integration
    Scenario: Removing a binding closes the path for the next call
      When an organization manager removes the binding for "llm.internal.acme.test"
      Then the next model call for "acme-prod" to that hostname is resolved as usual
      And a private answer is refused as a private address

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

  Rule: Installs that allow private calls see no change

    @unit
    Scenario: With BLOCK_LOCAL_HTTP_CALLS false, an unbound private host is allowed
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When a model call for a project in "Rival" targets "https://10.0.5.3/v1"
      Then the call is allowed
