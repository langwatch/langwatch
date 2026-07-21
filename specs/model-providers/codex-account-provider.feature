Feature: Codex, the sign-in-with-OpenAI model provider
  As someone with a paid OpenAI (ChatGPT) subscription
  I want to connect my OpenAI account as a model provider
  So that Langy and the small AI assists bill my plan, with no API key to manage

  # ---------------------------------------------------------------------------
  # Codex is a provider whose credential is an OAuth session with the user's
  # OpenAI account (the codex CLI device-code flow), not an API key. Requests
  # run through the AI gateway against OpenAI's codex backend
  # (chatgpt.com/backend-api/codex/responses, the Responses API, SSE), billed
  # to the user's ChatGPT plan.
  #
  # OpenAI's terms allow this ONLY for coding-agent harnesses and light
  # AI assists, so codex models are usable by Langy and the tiny assists
  # around the UI (Ask AI trace search, chat/commit title generation), and
  # nowhere else: no prompt playground, no evaluations, no workflows, no
  # batch inference.
  # ---------------------------------------------------------------------------

  Background:
    Given I am signed in to LangWatch with a project

  # ── Signing in ─────────────────────────────────────────────────────────────

  Scenario: Connecting Codex starts a device sign-in, not a key form
    When I pick Codex as a provider on any setup surface
    Then I see a one-time code and a link to OpenAI's device page instead of key fields
    And LangWatch polls until I approve the sign-in in my browser
    And on approval the provider is connected without me pasting anything

  Scenario: The connected state names the account
    Given I completed the Codex sign-in
    Then the provider shows the connected OpenAI account email and plan
    And offers disconnect and re-authenticate actions

  Scenario: Cancelling the sign-in leaves nothing behind
    Given a Codex sign-in is pending
    When I cancel it
    Then no provider is created and no tokens are stored

  Scenario: Sign-in that is never approved times out calmly
    Given a Codex sign-in is pending
    When the code expires before I approve it
    Then the surface says the sign-in timed out and offers to start again

  Scenario: Tokens are stored encrypted and scoped like any provider credential
    Given I completed the Codex sign-in
    Then the OAuth tokens are stored encrypted on the provider row
    And the provider saves at the widest scope I can manage, like other providers

  # ── Requests and token lifecycle ───────────────────────────────────────────

  Scenario: Langy turns run through the gateway against the codex backend
    Given Codex is my Langy model
    When Langy runs a turn
    Then the gateway calls OpenAI's codex Responses endpoint with my session
    And the response streams back to Langy as usual

  # The codex backend keeps no server-side state between requests, so a turn
  # that reasons, calls a tool, then reasons again about the result has to carry
  # its own reasoning forward. This is the difference between Langy answering a
  # one-shot question and Langy chaining tools to finish a real task.
  Scenario: Langy chains tools across a multi-step reasoning turn on Codex
    Given Codex is my Langy model
    When Langy runs a turn that calls a tool, reads the result, and calls another
    Then each step replays the earlier reasoning so the stateless backend accepts it
    And Langy finishes the task instead of failing partway through

  Scenario: An expired access token refreshes transparently
    Given my Codex access token has expired
    When a request hits the provider
    Then the gateway refreshes the token once and retries the request
    And the refreshed tokens replace the stored ones

  Scenario: A dead session asks me to sign in again
    Given my Codex refresh token is no longer valid
    When a request hits the provider
    Then the request fails as "session expired"
    And Langy shows a card asking me to re-authenticate Codex, with a button that starts the sign-in

  Scenario: Hitting my plan's usage limit is explained, with a way out
    Given my ChatGPT plan usage limit is reached
    When a Langy turn fails with the provider's limit refusal
    Then Langy explains my OpenAI plan limit was reached and roughly when it resets if known
    And suggests switching to another configured model for now

  # ── Where Codex may be used ────────────────────────────────────────────────

  Scenario: Codex models exist only on the allowed surfaces
    Given Codex is connected
    Then codex models are offered in Langy's model picker
    And in the default-model slots for the tiny assists (Ask AI search, title and commit generation)
    But not in the prompt playground, evaluations, workflows or any other model picker

  Scenario: The server refuses Codex outside the allowed surfaces
    Given Codex is connected
    When an execution path other than Langy or a tiny assist requests a codex model
    Then the request is rejected with a clear "not allowed for this feature" error

  Scenario: Setting up Codex for Langy also covers the tiny assists
    When I connect Codex from Langy's model setup
    Then Langy's default model becomes the codex model
    And the tiny assists default to it as well
    And evaluations, playground and workflows keep their existing defaults

  Scenario: Langy resolves its own feature key without breaking older setups
    Given Langy resolves its model through the langy.chat feature key
    When a project configured Langy before that key existed
    Then the resolver falls back to the original gate key
    And the project keeps working without re-setup

  # ── Placement per surface ──────────────────────────────────────────────────

  Scenario: Codex leads the Langy setup with a recommendation
    When Langy asks me to pick a provider on first use
    Then Codex is the first option, marked "Recommended"
    And the copy says it suits paid OpenAI accounts, and that the other providers take an API key instead

  Scenario: Codex leads the onboarding model step the same way
    When onboarding reaches the model-provider step
    Then Codex is the first option, marked "Recommended", with the same copy

  Scenario: Codex sits last when adding a provider in settings
    When I open settings to add a model provider
    Then Codex is the last option in the list
    Because it only serves the coding-assistant surfaces, not general inference
