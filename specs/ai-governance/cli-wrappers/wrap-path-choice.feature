Feature: CLI wrapper asks the user which path to run when both are allowed
  As a developer running `langwatch <tool>` (claude / codex / gemini / opencode / cursor)
  When my org permits BOTH the gateway path and the direct OTLP path for that tool
  I want the wrapper to ask me which one to use the first time, remember my answer,
  and let me override it with a flag
  So that I am not silently routed through the gateway (and billed for LLM usage)
  when I would rather use my own plan and send only telemetry to LangWatch.

  Two paths the wrapper can pick:
    - Path A "Gateway (virtual key)": LLM calls route through the LangWatch
      gateway via the user's personal virtual key. LLM usage is billed to the
      gateway. Offered in the prompt as "Using an API key".
      (cfg.tool_mode = "gateway")
    - Path B "Direct OTLP": the tool calls its own provider with the user's own
      plan, and only OTLP telemetry is sent to LangWatch, authorized by the
      user's personal ingest key. Offered in the prompt with per-tool
      subscription wording, e.g. "Using a Claude subscription" for claude.
      (cfg.tool_mode = "ingestion")

  The remembered answer lives in cfg.tool_mode[tool] (the existing per-tool
  routing field). The wrapper only prompts when the answer is not already
  pinned there, both paths are allowed by the org policy, and stdin/stdout is a
  TTY.

  Pairs with:
    - specs/ai-gateway/governance/cli-tool-mode-policy.feature (which paths are allowed)
    - specs/ai-governance/cli-wrappers/wrap-login-routing.feature (env injection + arg passthrough)

  Background:
    Given the user has completed `langwatch login --device` for org "acme"
    And the cached policy for "claude" allows both the gateway and direct OTLP paths

  Rule: prompt only when both paths are allowed, on a TTY, with no remembered answer

    # Launch-day users are mostly on Claude subscriptions, so the subscription (direct OTLP) choice is listed first and is the default.

    @unit
    Scenario: First interactive run with both paths allowed prompts for the path
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude`
      Then the wrapper shows a select prompt asking how `langwatch claude` should run
      And the prompt offers "Using a Claude subscription" first and "Using an API key" second
      And the pre-selected default is "Using a Claude subscription"

    @unit
    Scenario: Choosing the gateway remembers it and does not prompt again
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude` and picks "Using an API key"
      Then cfg.tool_mode.claude is saved as "gateway"
      And the wrapper prints a one-line tip explaining how to change it later
      When the user runs `langwatch claude` again
      Then the wrapper does NOT prompt and routes through the gateway

    @unit
    Scenario: Choosing direct OTLP remembers it as ingestion
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude` and picks "Using a Claude subscription"
      Then cfg.tool_mode.claude is saved as "ingestion"
      And the wrapper proceeds in ingestion mode

  Rule: exactly one allowed path is used silently, with no prompt

    @unit
    Scenario: Only the gateway path is allowed
      Given the cached policy for "claude" allows the gateway path but not direct OTLP
      And tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it routes through the gateway

    @unit
    Scenario: Only the direct OTLP path is allowed
      Given the cached policy for "claude" allows direct OTLP but not the gateway path
      And tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode

  Rule: the gateway path is only ever entered by explicit choice

    Routing through the gateway spends money: the model calls go through
    LangWatch-held provider credentials and are billed to the organization.
    The only ways in are the prompt, a pinned cfg.tool_mode, `--tool-mode=gateway`,
    and `LANGWATCH_TOOL_MODE=gateway`. Nothing the wrapper decides on its own,
    and no failure on the direct OTLP path, may put a run on it.

    @unit
    Scenario: Non-TTY takes the path that spends nothing
      Given tool_mode.claude is unset
      And stdin is not a TTY
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode

    @unit
    Scenario: LANGWATCH_AUTO_LOGIN skips the prompt
      Given tool_mode.claude is unset
      And `LANGWATCH_AUTO_LOGIN=1` is exported
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode

    @unit
    Scenario: Cancelling the path prompt cancels the run
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude` and aborts the select prompt
      Then the run is marked aborted and no path is persisted
      And the wrapper does NOT resolve to the gateway path

  Rule: an expired device session never reroutes the run onto the gateway

    Direct OTLP setup mints a personal ingest key against the control plane, so
    an expired device session fails it. That is a session problem, not a signal
    that the user wanted to be billed, so the wrapper says what happened and
    either recovers the session or stops.

    @unit
    Scenario: The mint 401 is recognised as an expired session
      Given the ingestion-key mint returns 401 "Session expired"
      Then the wrapper classifies the failure as an expired session
      And a `tool_disabled` policy error is NOT classified as one

    @unit
    Scenario: On a TTY the wrapper offers the login and stays on direct OTLP
      Given tool_mode.codex is "ingestion"
      And the device session has expired
      And stdin and stdout are a TTY
      When the user runs `langwatch codex`
      Then the wrapper explains that the session expired
      And it asks the user to log in again
      And on success it retries the direct OTLP path with the refreshed config

    @unit
    Scenario: Declining the login stops the run instead of starting the tool
      Given the device session has expired
      And stdin and stdout are a TTY
      When the user declines the login prompt
      Then the wrapper exits non-zero without starting the tool

    @unit
    Scenario: Without a TTY the wrapper exits and names the login command
      Given tool_mode.codex is "ingestion"
      And the device session has expired
      And stdin is not a TTY
      When the user runs `langwatch codex`
      Then the wrapper exits non-zero
      And the message names `langwatch login --device`
      And the message says the gateway path was not used

  Rule: an explicit override flag or env skips the prompt and is stripped from forwarded args

    @unit
    Scenario: --tool-mode=otlp forces ingestion and is not forwarded to the tool
      Given tool_mode.claude is unset
      When the user runs `langwatch claude --tool-mode=otlp -p "hi"`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode
      And the spawned `claude` receives argv `['-p', 'hi']` exactly
      And no `--tool-mode` flag leaks into the child's argv

    @unit
    Scenario: --tool-mode=gateway forces the gateway path
      Given tool_mode.claude is unset
      When the user runs `langwatch claude --tool-mode=gateway`
      Then the wrapper does NOT prompt
      And it routes through the gateway

    @unit
    Scenario: LANGWATCH_TOOL_MODE=otlp forces ingestion without a flag
      Given tool_mode.claude is unset
      And `LANGWATCH_TOOL_MODE=otlp` is exported
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode

  Rule: a remembered answer is used and never re-prompts

    @unit
    Scenario: A pinned tool_mode is honored with no prompt
      Given cfg.tool_mode.claude is "ingestion"
      And stdin and stdout are a TTY
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it proceeds in ingestion mode

  Rule: the gateway path is gated on a coding-assistant tile plus a configured provider credential

    The gateway program is opt-in per tool: an org enables it for a coding
    assistant by publishing that tool's coding-assistant tile (with the gateway
    path on). Once enabled, the wrapper routes a virtual key through the org's
    CONFIGURED provider credentials - it does NOT require a model_provider
    catalog tile (those gate only the /me one-click mint-your-own-VK surface).

    @unit
    Scenario: Gateway works from a configured credential without a provider tile
      Given the org has published a "codex" coding-assistant tile with the gateway path enabled
      And the org has a configured, enabled "openai" provider credential
      And the org has NOT published any model_provider catalog tile
      When the wrapper runs its gateway preflight for `langwatch codex`
      Then the preflight passes and the wrapper routes through the gateway

    @unit
    Scenario: Gateway is blocked when the tool has no coding-assistant tile
      Given the org has a configured, enabled "openai" provider credential
      And the org has NOT published a "codex" coding-assistant tile
      When the wrapper runs its gateway preflight for `langwatch codex`
      Then the preflight fails
      And it points the admin at the AI Tools catalog to publish the tile
