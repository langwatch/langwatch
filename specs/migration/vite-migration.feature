Feature: Next.js to Vite Migration
  As a LangWatch developer
  I want to migrate from Next.js to pure Vite with React Router
  So that the frontend builds faster and we eliminate unnecessary SSR overhead

  Background:
    Given the app is built with Vite instead of Next.js
    And the app uses React Router for client-side navigation
    And all API routes are served by standalone Hono server
    And the Hono server serves the Vite SPA for non-API routes

  # --- Frontend Routing ---

  Scenario: Client-side navigation between pages works
    Given I am logged in
    When I navigate to the messages page
    Then the page renders without a full page reload
    When I click on a project in the sidebar
    Then the URL updates to /<project>/messages
    And the page renders the project messages

  Scenario: Dynamic route parameters are resolved
    Given I am on the messages page for project "my-project"
    When I click on a trace
    Then the URL updates to /my-project/messages/<traceId>
    And the trace detail panel opens

  Scenario: Query string filters are preserved across navigation
    Given I am on the messages page with filters "?topics=greeting&sentiment=positive"
    When I apply a date range filter
    Then all previous query string parameters remain intact
    And the new date range parameter is added to the URL

  Scenario: Analytics page query string management works
    Given I am on the analytics page
    When I change chart filters via the UI
    Then the URL query string updates to reflect the selection
    When I share the URL with another user
    Then they see the same filter configuration

  Scenario: Custom analytics dashboards preserve URL state
    Given I am on a custom analytics dashboard
    When I modify the time range and grouping
    Then the query string reflects both changes
    When I refresh the page
    Then the filters are restored from the URL

  Scenario: Evaluations-v3 autosave navigation works
    Given I am editing an evaluation configuration
    When the configuration auto-saves
    Then the URL slug updates to reflect the saved evaluation
    And navigating away and back preserves the state

  Scenario: Browser back/forward navigation works
    Given I have navigated through several pages
    When I press the browser back button
    Then I return to the previous page with its state intact
    When I press the browser forward button
    Then I return to the next page with its state intact

  Scenario: Deep links work for all route patterns
    Given I am not on the app
    When I navigate directly to /my-project/analytics/evaluations?dateRange=7d
    Then the app loads the analytics evaluations page
    And the date range filter shows 7 days

  Scenario: Catch-all routes for simulations work
    Given I navigate to /my-project/simulations/some/nested/path
    Then the simulations page renders with the path segments available

  Scenario: NProgress loading bar shows during navigation
    When I navigate between pages
    Then a progress bar appears at the top of the page during transition

  Scenario: Feature flag query params persist across navigation
    Given I have "?NEXT_PUBLIC_FEATURE_X=true" in the URL
    When I navigate to another page
    Then the feature flag query parameter is preserved

  # --- API Routes ---

  Scenario: Collector endpoint accepts trace data
    Given I have a valid API key for project "test-project"
    When I POST a trace with spans to /api/collector
    Then I receive a 200 response with success status
    And the spans are recorded in the system

  Scenario: Collector endpoint validates authentication
    When I POST to /api/collector without an auth token
    Then I receive a 401 response

  Scenario: Collector endpoint handles large payloads
    Given I have a valid API key
    When I POST a trace with 200 spans (near the limit)
    Then I receive a 200 response
    When I POST a trace with 201 spans (over the limit)
    Then I receive an error about exceeding span limit

  Scenario: Collector endpoint deduplicates traces
    Given I have a valid API key
    When I POST the same trace data twice
    Then only one trace is recorded

  Scenario: tRPC endpoints work through Hono
    Given I am authenticated
    When I call a tRPC query via /api/trpc/<procedure>
    Then I receive the expected response with superjson encoding

  Scenario: tRPC batch requests work
    Given I am authenticated
    When I send a batched tRPC request with multiple queries
    Then all queries resolve correctly

  Scenario: SSE subscriptions work for real-time updates
    Given I am authenticated
    When I subscribe to trace updates via /api/sse/<procedure>
    Then I receive a text/event-stream response
    And keep-alive pings arrive every 25 seconds
    When a new trace is recorded
    Then I receive the update as an SSE event

  Scenario: Auth endpoints work
    When I POST credentials to /api/auth/sign-in/credentials
    Then I receive a valid session cookie
    When I GET /api/auth/session with the cookie
    Then I receive my session data

  Scenario: OAuth callback rewrites work
    When an OAuth provider redirects to /api/auth/callback/auth0
    Then the request is handled by the auth callback handler

  Scenario: OTEL endpoints accept trace data
    When I POST OpenTelemetry trace data to /api/otel/v1/traces
    Then the traces are accepted and processed

  Scenario: Health check endpoints respond
    When I GET /api/health
    Then I receive a 200 response
    When I GET /api/health/collector
    Then I receive the collector health status

  Scenario: Hono API routes with catch-all patterns work
    When I GET /api/traces/search?query=hello
    Then the traces search endpoint responds
    When I POST /api/evaluators
    Then the evaluators endpoint responds

  Scenario: Streaming evaluation responses work
    Given I am authenticated
    When I trigger an evaluation execution via /api/evaluations/v3/execute
    Then I receive a streaming response
    And evaluation progress events arrive in order

  Scenario: SCIM provisioning endpoints work
    When I send a SCIM v2 request to /api/scim/v2/Users
    Then the SCIM endpoint responds with the correct schema

  # --- Build & Deployment ---

  Scenario: Vite dev server starts successfully
    When I run the dev server
    Then the server starts on the configured port
    And the frontend is accessible in the browser
    And hot module replacement works for code changes

  Scenario: Production build completes
    When I run the build command
    Then Vite produces optimized static assets
    And the Hono server bundle is produced
    And no build errors occur

  Scenario: Docker image builds and runs
    When I build the Docker image
    Then the image builds successfully
    And the container starts and serves the application
    And both API routes and frontend pages are accessible

  Scenario: Metrics endpoint still works
    When I GET /metrics with valid authorization
    Then I receive Prometheus metrics output

  # --- Provider & State ---

  Scenario: tRPC provider wraps the entire app
    Given the app renders
    Then tRPC queries and mutations are available in all components
    And superjson serialization works for Date objects

  Scenario: Auth session is available throughout the app
    Given I am logged in
    Then useSession() returns my user data in any component
    And session refresh works without page reload

  Scenario: Chakra UI theming works
    Given the app renders
    Then the custom theme tokens are applied
    And dark mode toggle works
    And semantic color tokens resolve correctly

  Scenario: Command bar opens with keyboard shortcut
    Given I am on any authenticated page
    When I press Cmd+K
    Then the command palette opens
