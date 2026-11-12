Feature: MCP outbound request and browser capability hardening
  As a LangWatch operator
  I want documentation tools and browser responses to follow least privilege
  So that authenticated callers cannot turn LangWatch into a network proxy
  and browser features are disabled unless the application needs them

  Rule: MCP documentation tools fetch only their trusted documentation namespace

    @integration @regression
    Scenario Outline: A documentation tool accepts its own trusted HTTPS pages
      Given the MCP tool "<tool>" is available
      When it receives the URL "<url>"
      Then it fetches the documentation page with redirects disabled

      Examples:
        | tool                 | url                                             |
        | fetch_langwatch_docs | https://langwatch.ai/docs/observability/tracing |
        | fetch_scenario_docs  | https://langwatch.ai/scenario/guides/quickstart |

    @integration @regression
    Scenario Outline: A documentation tool rejects non-HTTPS and untrusted hosts
      Given the MCP tool "<tool>" is available
      When it receives the URL "<url>"
      Then it returns a validation error
      And LangWatch makes no outbound request to that URL

      Examples:
        | tool                 | url                                           |
        | fetch_langwatch_docs | http://169.254.169.254/latest/meta-data/      |
        | fetch_langwatch_docs | https://langwatch.ai.attacker.example/docs/x |
        | fetch_langwatch_docs | https://user@attacker.example/docs/x         |
        | fetch_scenario_docs  | http://127.0.0.1:8080/secrets                 |
        | fetch_scenario_docs  | file:///etc/passwd                            |

    @unit @regression
    Scenario Outline: A documentation tool rejects a trusted host outside its namespace
      Given the MCP tool "<tool>" is available
      When it receives the URL "<url>"
      Then it returns a validation error

      Examples:
        | tool                 | url                                      |
        | fetch_langwatch_docs | https://langwatch.ai/scenario/llms.txt   |
        | fetch_scenario_docs  | https://langwatch.ai/docs/llms.txt       |
        | fetch_langwatch_docs | https://langwatch.ai/docs-evil/page.md   |
        | fetch_scenario_docs  | https://langwatch.ai/scenario-evil/x.md  |

    @integration @regression
    Scenario: Documentation fetches do not follow redirects
      Given a trusted documentation URL returns an HTTP redirect
      When an MCP documentation tool fetches that URL
      Then the redirect is not followed
      And no response body from the redirect destination is returned

  Rule: Application responses explicitly disable unused browser capabilities

    @integration @regression
    Scenario: Production HTTP responses include the Permissions-Policy header
      Given LangWatch is running in production mode
      When a client requests the application root
      Then the response contains the Permissions-Policy header
      And geolocation is disabled
      And microphone is allowed only for the app's own origin, for the voice agents panel
      And camera is disabled
      And payment is disabled
      And USB is disabled

    @unit @regression
    Scenario: Development responses report the production CSP without enforcing it
      Given LangWatch is running in development mode
      When a client requests the application root
      Then the response carries no Content-Security-Policy header
      And it carries the production policy as Content-Security-Policy-Report-Only
      And a directive that would break production is visible as a console violation locally

  Rule: Other MCP HTTP tools cannot reach non-public destinations

    @integration @regression
    Scenario Outline: Running an HTTP agent rejects unsafe destinations
      Given a saved HTTP agent targets "<url>"
      When the MCP tool runs that agent
      Then it returns a validation error
      And LangWatch makes no outbound request to that URL

      Examples:
        | url                                      |
        | http://127.0.0.1:8080/secrets           |
        | http://169.254.169.254/latest/meta-data/ |
        | http://10.0.0.1/internal                 |

    @integration @regression
    Scenario: HTTP agent redirects are revalidated
      Given a saved HTTP agent targets a public URL
      And that URL redirects to a private destination
      When the MCP tool runs that agent
      Then it returns a validation error
      And LangWatch does not request the private destination

  Rule: The anonymous docs endpoint's shared fetcher keeps its cache bounded

    @unit
    Scenario: A cached docs page is fetched again once its time to live has passed
      Given the shared documentation fetcher has served a page
      When the same page is asked for again after its 60 second time to live
      Then it is fetched from the docs again

    @unit
    Scenario: The docs cache drops its oldest page past the entry limit
      Given the shared documentation fetcher holds as many pages as its entry limit
      When another page is fetched
      Then the oldest cached page is dropped and fetched again when next asked for

    @unit
    Scenario: A docs page larger than the whole cache is served but not kept
      Given a docs page larger than the cache's byte limit
      When it is asked for twice
      Then it is served both times and fetched both times

    @unit
    Scenario: The shared fetcher refuses a URL outside the docs before fetching it
      Given the shared documentation fetcher
      When it is asked for a URL outside the trusted docs
      Then it refuses with a validation error, without fetching or counting it
