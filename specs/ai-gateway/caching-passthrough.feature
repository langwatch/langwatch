Feature: Caching passthrough (Anthropic cache_control + gateway semantic cache)
  The gateway must never silently break upstream provider caching. Anthropic
  prompt caching pays for itself in 90% input-cost savings on cache hits;
  our gateway is in the hot path of every call, so any stripping / reordering
  of cache_control blocks is catastrophic for customer bill.

  See contract.md §6.

  Background:
    Given a VK configured with cache.mode = "respect" (default)

  Rule: Anthropic cache_control byte-for-byte invariant

    @integration
    Scenario: cache_control on system message passes through untouched
      When I POST /v1/messages with:
        """
        {
          "model": "claude-haiku-4-5",
          "system": [
            {"type": "text", "text": "You are helpful", "cache_control": {"type": "ephemeral"}}
          ],
          "messages": [{"role": "user", "content": "hi"}]
        }
        """
      Then the body forwarded to Anthropic is byte-equivalent in the system[0].cache_control field
      And the response `usage` block includes cache_read_input_tokens / cache_creation_input_tokens

    @integration
    Scenario: cache_control on tool definitions passes through untouched
      When I POST /v1/messages with tools carrying cache_control: {"type": "ephemeral"}
      Then the tools[*].cache_control fields are preserved byte-for-byte

    @integration
    Scenario: cache_control on assistant turn in conversation history is preserved
      When I POST a multi-turn /v1/messages with cache_control marking the last assistant turn
      Then the forwarded body still has cache_control on that exact turn (no reordering of messages)

    @integration
    Scenario: even when the gateway adds X-LangWatch-Request-Id, the request body is unchanged
      When I POST /v1/messages with cache_control
      Then the request body sent to Anthropic has the same SHA-256 as the original client body
      And no header injection mutates the body

  Rule: OpenAI prompt caching semantics

    @integration
    Scenario: OpenAI implicit prompt caching (prefix reuse) honored
      Given two consecutive /v1/chat/completions requests with the same 2k-token system prompt
      When the second request hits OpenAI
      Then response.usage.prompt_tokens_details.cached_tokens > 0
      And the gateway preserves OpenAI's `prompt` / `prefix_cache` fields without modification

  Rule: Per-request override header

    @integration
    Scenario: X-LangWatch-Cache: disable recursively strips cache_control at any depth
      Given a request with cache_control blocks on system[0], messages[2].content[1], and tools[0]
      When I send header "X-LangWatch-Cache: disable"
      Then the gateway removes every cache_control key from the forwarded body
      And the response header "X-LangWatch-Cache: bypass" is set
      And the response header "X-LangWatch-Cache-Mode: disable" echoes the applied mode

    @integration
    Scenario: X-LangWatch-Cache: respect is the default and echoes the applied mode
      Given a request with cache_control blocks set
      When no X-LangWatch-Cache header is sent
      Then the gateway forwards cache_control byte-for-byte
      And the response header "X-LangWatch-Cache-Mode: respect" echoes the applied mode

    @integration
    Scenario: X-LangWatch-Cache: force is deferred to v1.1 and 400s in v1
      When I send header "X-LangWatch-Cache: force"
      Then the response status is 400
      And the error envelope type is "cache_override_not_implemented"
      And the envelope message points at the v1.1 roadmap

    @integration
    Scenario: X-LangWatch-Cache: ttl=3600 is deferred to v1.1 and 400s in v1
      When I send header "X-LangWatch-Cache: ttl=3600"
      Then the response status is 400
      And the error envelope type is "cache_override_not_implemented"

    @integration
    Scenario: malformed X-LangWatch-Cache header returns cache_override_invalid
      When I send header "X-LangWatch-Cache: bananas"
      Then the response status is 400
      And the error envelope type is "cache_override_invalid"
      And the envelope message names the rejected mode

    @integration
    Scenario: cache-override runs before blocked-pattern enforcement
      Given a VK with blocked_patterns.models.deny = ["^claude-haiku-4-5$"]
      And a request that also sets X-LangWatch-Cache: disable
      When the request is dispatched
      Then the cache_control blocks are stripped FIRST
      And the blocked-pattern check evaluates the post-strip body
      And the response is 403 model_not_allowed (not 400 cache_*)
      # Deterministic policy evaluation independent of caller's caching choice.

  Rule: Cache token accounting in trace

    @integration
    Scenario: OTel trace reports cache_read and cache_write tokens separately
      Given a cache-hit request against Anthropic
      When I inspect the exported trace
      Then span attributes include `langwatch.usage.input_tokens`
      And span attributes include `langwatch.usage.cache_read_tokens`
      And span attributes include `langwatch.usage.cache_write_tokens`
      And the cost calculation in budget/debit uses the discounted cache_read rate (10% of list)
