Feature: Record which credential and client each API request used

  Every authenticated API request is counted by the credential it used, the project, the route
  template and the client that sent it. Each process writes one line a minute per credential,
  project, route and client under the logger langwatch:api:credential-census, with the number of
  requests folded into it, and tags the request span with langwatch.auth.* and langwatch.client.*
  attributes. Ops reads these lines to see which projects still send legacy project keys, and
  from which clients, before scoping or rotating them. The census only observes: no request is
  refused or admitted because of it, and no token, body or query string is ever written.

  Rule: Each credential kind is counted as itself, with its ids

    @integration
    Scenario: A legacy project key sent by the Python SDK is counted as a legacy key from sdk-python
      Given a project with a legacy project key
      When the Python SDK calls a REST route with that key
      Then the census counts the request as credential type "legacy_project_key" for that project
      And the client is "sdk-python", with the SDK name and version

    @integration
    Scenario: A new API key sent by the CLI is counted with its key id and client cli
      Given an API key minted for a project
      When the CLI calls a REST route with that key
      Then the census counts the request as credential type "api_key" with the key's row id
      And the client is "cli"

    @unit
    Scenario: A key minted by a CLI login is counted as a CLI token
      Given an API key a CLI login minted
      When it authenticates a request
      Then the census counts the request as credential type "cli_token" with the key's row id

    @unit
    Scenario: A CLI access token is counted as a CLI token
      Given a project-bound CLI access token
      When it authenticates a REST request
      Then the census counts the request as credential type "cli_token" for its project

    @unit
    Scenario: A browser session on a REST route is counted as a session
      Given a REST route behind the browser session door
      When a signed-in browser calls it
      Then the census counts the request as credential type "session" from client "browser"

    @unit
    Scenario: An internal credential is counted as the system
      Given a route behind the internal secret door
      When the platform calls it
      Then the census counts the request as credential type "system"

    @unit
    Scenario: A token that resolves no credential is not counted
      When a request presents a token that matches no key
      Then the census counts nothing for it

  Rule: Every authenticated path is counted

    @unit
    Scenario: Trace ingest through the collector is counted per project
      Given a project key
      When an SDK posts traces to the collector with it
      Then the census counts the request for the collector route and that project

    @unit
    Scenario: A connected agent's socket is counted when the door admits it
      Given a project key
      When a connected agent opens its socket with it
      Then the census counts one upgrade for the socket path and that project

    @unit
    Scenario: A hosted MCP request is counted with client hosted-mcp
      Given a legacy project key
      When an MCP client calls the hosted MCP endpoint with it
      Then the census counts the request as credential type "legacy_project_key" from client "hosted-mcp"

    @unit
    Scenario: The hosted MCP's own API calls are counted with client hosted-mcp
      Given the hosted MCP server running a tool for a session
      When the tool calls the LangWatch API
      Then the call names itself as the hosted MCP
      And the census counts it from client "hosted-mcp"

  Rule: The census is folded, bounded and carries no secrets

    @unit
    Scenario: Repeated requests within a minute are written as one line with their count
      Given the same key calls the same route from the same client five times within a minute
      When the minute ends
      Then one census line is written with count 5
      And a request after that minute opens a new line

    @unit
    Scenario: The census holds a bounded number of windows
      Given the census is holding its most windows
      When a request opens one more
      Then the oldest window is written early with its count

    @unit
    Scenario: The census line never carries the token or the query string
      When a request with a token and a query string is counted
      Then the census line carries the route template, not the URL
      And neither the token nor the query string appears in the line

    @unit
    Scenario: Clients are told apart by their identity headers and user agent
      Then the census names the client by these headers:
        | headers                                                                  | client         |
        | X-LangWatch-SDK-Name: langwatch-observability-sdk, SDK-Language: python   | sdk-python     |
        | X-LangWatch-SDK-Name: langwatch-observability-sdk, SDK-Language: typescript | sdk-typescript |
        | X-LangWatch-SDK-Name: langwatch-sdk-go, SDK-Language: go                 | sdk-go         |
        | User-Agent: langwatch-sdk-python/0.9                                     | sdk-python     |
        | X-LangWatch-Surface: cli (with the TypeScript SDK headers)               | cli            |
        | User-Agent: langwatch-cli/1.0                                            | cli            |
        | X-LangWatch-SDK-Name: langwatch-mcp                                      | mcp            |
        | X-LangWatch-MCP-Host: hosted (with the MCP headers)                      | hosted-mcp     |
        | User-Agent: OTel-OTLP-Exporter-Python/1.0                                | otel-exporter  |
        | User-Agent: Mozilla/5.0                                                  | browser        |
        | User-Agent: curl/8.0                                                     | other          |

  Rule: The census only observes

    @unit
    Scenario: The access line names the project and the credential type
      When an authenticated REST request is answered
      Then the langwatch:api:hono access line carries its project id and credential type

    @unit
    Scenario: The request span carries the credential and client attributes
      When an authenticated REST request is answered
      Then its span carries langwatch.auth.credential_type, langwatch.auth.project_id and langwatch.client.name

    @integration
    Scenario: Counting a request does not change its authorization answer
      Given a key that may not call a route
      When it calls that route, and a permitted key calls it too
      Then the refused request is still refused and the permitted one still answered
      And each is counted with the status it was answered with
