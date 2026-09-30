Feature: ACME checkout demo application

  The guided onboarding has Langy instrument a customer application live: it
  reads the code, says "Detected LangGraph", adds tracing, points the connected
  agent endpoint at the platform and writes the first scenario, "Guest
  completes checkout". For every one of those to be real work, the demo it
  works on ships as a plain LangGraph application: a guest checkout agent for
  the ACME store with real graph nodes, no tracing, no tests and no LangWatch
  dependency. dev/dogfood/acme-checkout/python is that application, and the
  Langy scenario harness copies it into a temporary repository the same way it
  copies the ACME support demos.

  Background:
    Given the acme-checkout demo application in dev/dogfood/acme-checkout/python

  @e2e
  Scenario: The application boots with only an OpenAI key
    Given a copy of the application with OPENAI_API_KEY set and nothing else
    When the developer runs uv sync and starts the server on a free port
    Then the health endpoint answers ok
    And the process needs no LangWatch key, endpoint or account

  @e2e
  Scenario: A guest completes a checkout in one conversation
    Given the application is running
    When the guest asks what is in the cart
    Then the agent lists the cart lines and the total
    When the guest applies the code SPRING25
    Then the agent says the code has expired and leaves the total unchanged
    When the guest applies the code WELCOME10
    Then the agent confirms the discount and the lower total
    When the guest pays with a card
    Then the agent confirms the payment
    When the guest asks to place the order
    Then the agent gives an order number
    And the same order number is in the response body

  @e2e
  Scenario: A declined card does not produce an order
    Given the application is running
    When the guest pays with a card that ends in 0000
    Then the agent says the payment was declined
    And no order number is given

  @unit
  Scenario: The application ships without tracing and without tests
    When the source tree is scanned
    Then no dependency and no import names langwatch or opentelemetry
    And there is no test folder and no test dependency
    And the README says both are missing on purpose

  @unit
  Scenario: The scenario harness copies it into a temporary repository
    When a Langy scenario creates a demo repository in the langgraph language
    Then the copy is its own git repository on main with one commit
    And the copy carries the application sources and the README
    And pyproject.toml is byte for byte the shipped one, with no LangWatch SDK path
