Feature: PostHog cost control
  As a LangWatch operator
  I want PostHog feature flag and analytics traffic to scale with real user activity, not with the size of the React tree or the volume of spans
  So that the bill is predictable and proportional to real usage

  Background:
    Given the langwatch app uses posthog-js for client-side analytics
    And the langwatch app uses posthog-node for server-side feature flag evaluation
    And feature flags target users, projects, and organizations via personProperties

  # --- Frontend pageview emission ---

  Scenario: A single client-side navigation produces exactly one pageview event
    Given the application is rendered with N components that call useRouter()
    When the user navigates from "/projectA/messages" to "/projectA/analytics"
    Then exactly one $pageview event is captured by PostHog
    And the count is independent of N

  Scenario: Mounting additional useRouter() consumers does not multiply pageviews
    Given the user is on a page with K useRouter() consumers
    When K more components mount that also call useRouter()
    And the user navigates to a new route
    Then exactly one $pageview event is captured by PostHog

  Scenario: useRouter consumers do not need to subscribe to routeChangeComplete to navigate
    Given the application uses the next-router compat layer
    When the user navigates between pages
    Then router.events listeners that components register are notified once per navigation
    And no listener is invoked more than once for a single navigation

  Scenario: Initial page load is captured exactly once
    When the user first opens the app
    Then exactly one $pageview event is captured for the initial URL

  Scenario: Search-only URL changes do not flood PostHog
    Given the user is on "/projectA/messages"
    When the user changes a query string parameter via router.replace
    Then at most one $pageview is captured for the search-only update

  # --- Backend feature flag evaluation ---

  Scenario: Backend feature flag service uses local evaluation when available
    Given POSTHOG_KEY and POSTHOG_FEATURE_FLAGS_KEY are configured
    When the backend evaluates any feature flag
    Then the flag is evaluated locally without calling the PostHog /flags endpoint
    And no /flags request is made for that evaluation

  Scenario: Backend falls back to remote evaluation when no personal API key is configured
    Given POSTHOG_KEY is configured but POSTHOG_FEATURE_FLAGS_KEY is not
    When the backend evaluates a feature flag
    Then the value is fetched from PostHog /flags
    And the result is cached per the configured TTL

  Scenario: Hot-path killswitches are cached longer than user-facing flags
    Given the backend evaluates an event-sourcing killswitch like "es-trace-projection-killswitch"
    When the same killswitch is checked again within the killswitch TTL window
    Then the cached value is returned without calling PostHog
    And the killswitch TTL is at least 60 seconds

  Scenario: Frontend feature flags keep their fast 5-second TTL
    Given the frontend asks for a flag in FRONTEND_FEATURE_FLAGS
    When the same flag is requested again within 5 seconds
    Then the cached value is returned
    And the cache TTL is 5 seconds (so kill-switch-style changes propagate within 5s)

  Scenario: Token estimation kill switch does not stampede PostHog under high span volume
    Given 10,000 LLM spans are processed for a single project within one minute
    When each span checks the global and per-project token-estimation killswitches
    Then PostHog receives no remote /flags requests when local evaluation is enabled
    And PostHog receives at most a small bounded number of /flags requests when local evaluation is disabled

  # --- Resilience ---

  Scenario: PostHog outage does not break flag evaluation
    Given the PostHog service is unreachable
    When the backend evaluates a feature flag
    Then the configured default value is returned
    And the request continues without raising

  Scenario: Local evaluation polling failure does not break flag evaluation
    Given local evaluation is enabled but the polling request fails
    When a flag is evaluated
    Then the last-known value is used if available, otherwise the default value
