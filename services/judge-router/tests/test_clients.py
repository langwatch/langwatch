import json

import pytest

from judge_router.clients import (KEY_INVALID, RATE_LIMITED, TOO_LARGE, UNAVAILABLE, AnthropicClient, BackendError,
                                  BackendTimeout, DecisionsClient, JudgeCall, OpenAIResponsesClient, VllmClient,
                                  cut_keeping_ends, JevClient, price)


class Transport:
    def __init__(self, status=200, body=None, exc=None):
        self.status, self.body, self.exc, self.seen = status, body or {}, exc, []

    def __call__(self, url, headers, body, timeout_s):
        self.seen.append((url, headers, body, timeout_s))
        if self.exc:
            raise self.exc
        return self.status, self.body


CALL = JudgeCall(job="search", text="user: my order is late", question="Is the user upset?")


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic")
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-typesafe")


def test_decisions_request_and_probability(keys):
    t = Transport(body={"answers": [{"type": "predicate", "name": "q", "probability": 0.81}], "usage": {"input_tokens": 1000}})
    a = DecisionsClient(transport=t).judge(CALL, 10)
    url, headers, body, timeout = t.seen[0]
    assert url.endswith("/v1/decisions") and headers["authorization"] == "Bearer test-openai" and timeout == 10
    assert body["model"] == "gpt-6-luna" and body["questions"] == [{"type": "predicate", "name": "q", "instructions": "Is the user upset?"}]
    assert (a.verdict, a.probability) == (True, 0.81) and a.cost_usd == pytest.approx(1000 / 1e6 * 0.10)


def test_decisions_scenario_question(keys):
    t = Transport(body={"answers": [{"type": "predicate", "name": "q", "probability": 0.2}], "usage": {}})
    call = JudgeCall(job="scenario_judge", text="conversation", question="the agent offered a refund", scenario="angry customer")
    a = DecisionsClient(transport=t).judge(call, 10)
    body = t.seen[0][2]
    assert body["input"].startswith("# Scenario\nangry customer\n\n# Conversation\n")
    assert "Criterion: the agent offered a refund" in body["questions"][0]["instructions"] and "\nTrue: " in body["questions"][0]["instructions"]
    assert a.verdict is False


@pytest.mark.parametrize("status,reason", [(401, KEY_INVALID), (403, KEY_INVALID), (429, RATE_LIMITED), (413, TOO_LARGE), (503, UNAVAILABLE)])
def test_status_to_skip_reason(keys, status, reason):
    with pytest.raises(BackendError) as e:
        DecisionsClient(transport=Transport(status=status)).judge(CALL, 10)
    assert e.value.reason == reason


def test_refusal_or_unreadable_is_unavailable(keys):
    with pytest.raises(BackendError) as e:
        DecisionsClient(transport=Transport(body={"answers": [{"type": "refusal", "name": "q"}]})).judge(CALL, 10)
    assert e.value.reason == UNAVAILABLE


def test_timeout_propagates(keys):
    with pytest.raises(BackendTimeout):
        DecisionsClient(transport=Transport(exc=BackendTimeout("t"))).judge(CALL, 10)


def test_missing_key_is_key_invalid():
    with pytest.raises(BackendError) as e:
        DecisionsClient(transport=Transport()).judge(CALL, 10)
    assert e.value.reason == KEY_INVALID


def test_haiku_forced_tool_and_parse(keys):
    t = Transport(body={"content": [{"type": "tool_use", "name": "evaluation", "input": {"reasoning": "r", "result": False}}],
                        "usage": {"input_tokens": 2000, "output_tokens": 100}})
    a = AnthropicClient(transport=t).judge(CALL, 30)
    url, headers, body, _ = t.seen[0]
    assert url.endswith("/v1/messages") and headers["x-api-key"] == "test-anthropic"
    assert body["tool_choice"] == {"type": "tool", "name": "evaluation"} and body["model"] == "claude-haiku-5-5"
    assert "# Task\nAnswer this question about the text above with true (yes) or false (no): Is the user upset?" in body["messages"][0]["content"]
    assert (a.verdict, a.probability) == (False, None) and a.cost_usd == pytest.approx(price("haiku", 2000, 100))


def test_haiku_without_tool_call_fails(keys):
    with pytest.raises(BackendError):
        AnthropicClient(transport=Transport(body={"content": [{"type": "text", "text": "yes"}]})).judge(CALL, 30)


def test_luna_responses_parse(keys):
    t = Transport(body={"output": [{"type": "function_call", "name": "evaluation", "arguments": json.dumps({"reasoning": "r", "result": True})}],
                        "usage": {"input_tokens": 500, "output_tokens": 50}})
    a = OpenAIResponsesClient(transport=t).judge(JudgeCall(job="llm_judge", text="answer", question="Return true if polite"), 30)
    body = t.seen[0][2]
    assert t.seen[0][0].endswith("/v1/responses") and body["tool_choice"] == {"type": "function", "name": "evaluation"}
    assert body["input"][0]["content"].startswith("Return true if polite\n\n")
    assert a.verdict is True


def test_vllm_reads_yes_no_logprobs(monkeypatch):
    monkeypatch.setenv("VEGA_BASE_URL", "http://gpu.invalid")
    t = Transport(body={"choices": [{"logprobs": {"top_logprobs": [{"true": -0.1, "false": -2.4, "x": -5}]}}]})
    a = VllmClient("vega", "vega-run2", "VEGA_BASE_URL", prompt_of=lambda c: "p", transport=t).judge(CALL, 5)
    assert a.verdict is True and 0.85 < a.probability < 0.95 and a.cost_usd == 0


def test_vllm_without_endpoint_is_unavailable():
    with pytest.raises(BackendError) as e:
        VllmClient("vega", "m", "VEGA_BASE_URL_UNSET", prompt_of=lambda c: "p", transport=Transport()).judge(CALL, 5)
    assert e.value.reason == UNAVAILABLE


def test_cut_keeping_ends():
    text = "A" * 1000 + "B" * 1000
    out, cut = cut_keeping_ends(text, 600)
    assert cut and out.startswith("A") and out.endswith("B") and len(out.encode()) < 800
    assert cut_keeping_ends("short", 600) == ("short", False)


def test_long_context_price():
    assert price("haiku", 200_000, 0) == pytest.approx(200_000 / 1e6 * 0.5)
    assert price("decisions", 300_000, 0) == pytest.approx(300_000 / 1e6 * 0.2)


def test_jev_request_as_the_platform_sends_it(keys):
    t = Transport(body={"model": "jev-1.14.0", "answers": {"q": {"type": "noul", "noul": 0.3}}, "usage": {"input_tokens": 2000}})
    a = JevClient(transport=t).judge(CALL, 10)
    url, headers, body, _ = t.seen[0]
    assert url == "https://api.typesafe.ai/v1/systemone" and headers["authorization"] == "Bearer test-typesafe"
    assert body == {"state": CALL.text, "model": "jev-latest", "questions": {"q": {"type": "noul", "instructions": "Is the user upset?"}}}
    assert (a.verdict, a.probability) == (False, 0.3) and a.cost_usd == pytest.approx(2000 / 1e6 * 0.042)


def test_jev_scenario_criteria_and_errors(keys):
    t = Transport(body={"answers": {"q": {"noul": 0.9}}})
    call = JudgeCall(job="scenario_judge", text="conv", question="the agent apologised", scenario="s")
    assert JevClient(transport=t).judge(call, 10).verdict is True
    q = t.seen[0][2]["questions"]["q"]
    assert set(q["criteria"]) == {"true", "false"} and "Criterion: the agent apologised" in q["instructions"]
    with pytest.raises(BackendError) as e:
        JevClient(transport=Transport(body={"answers": {}})).judge(CALL, 10)
    assert e.value.reason == UNAVAILABLE
    with pytest.raises(BackendError) as e:
        JevClient(transport=Transport(status=429)).judge(CALL, 10)
    assert e.value.reason == RATE_LIMITED
