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
      gateway. (cfg.tool_mode = "gateway")
    - Path B "Direct OTLP": the tool calls its own provider with the user's own
      plan, and only OTLP telemetry is sent to LangWatch, authorized by the
      user's personal ingest key. (cfg.tool_mode = "ingestion")

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

    @unit
    Scenario: First interactive run with both paths allowed prompts for the path
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude`
      Then the wrapper shows a select prompt asking how `langwatch claude` should run
      And the prompt offers a "Gateway (virtual key)" choice and a "Direct OTLP" choice

    @unit
    Scenario: Choosing the gateway remembers it and does not prompt again
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude` and picks "Gateway (virtual key)"
      Then cfg.tool_mode.claude is saved as "gateway"
      And the wrapper prints a one-line tip explaining how to change it later
      When the user runs `langwatch claude` again
      Then the wrapper does NOT prompt and routes through the gateway

    @unit
    Scenario: Choosing direct OTLP remembers it as ingestion
      Given tool_mode.claude is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch claude` and picks "Direct OTLP"
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

  Rule: non-interactive and forced contexts default to the gateway with no prompt

    @unit
    Scenario: Non-TTY defaults to the gateway
      Given tool_mode.claude is unset
      And stdin is not a TTY
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it defaults to the gateway path

    @unit
    Scenario: LANGWATCH_AUTO_LOGIN skips the prompt
      Given tool_mode.claude is unset
      And `LANGWATCH_AUTO_LOGIN=1` is exported
      When the user runs `langwatch claude`
      Then the wrapper does NOT prompt
      And it defaults to the gateway path

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
