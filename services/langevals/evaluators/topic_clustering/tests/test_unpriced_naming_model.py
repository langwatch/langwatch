"""Topic names from a model litellm cannot price are kept, at zero cost.

Spec: specs/nlp-go/topic-clustering.feature
"""

import json
from types import SimpleNamespace

import litellm

import langevals_topic_clustering.topic_naming as topic_naming


def named(**names):
    call = SimpleNamespace(function=SimpleNamespace(arguments=json.dumps(names)))
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[call]))])


# @scenario "Topic names from a model litellm cannot price are kept"
def test_names_survive_a_missing_price(monkeypatch):
    monkeypatch.setattr(
        litellm, "completion", lambda **_kwargs: named(topic_0="Billing", topic_1="Login")
    )
    # litellm_patch answers None when litellm has no price for the model.
    monkeypatch.setattr(topic_naming, "completion_cost", lambda *_args, **_kwargs: None)

    names, cost = topic_naming.generate_topic_names_split(
        {"model": "openai/@cf/deepseek-ai/deepseek-v4.1-flash-1017"},
        topic_examples=[["invoice is wrong"], ["cannot sign in"]],
    )

    assert names == ["Billing", "Login"]
    assert cost["amount"] == 0


def unpriceable(*_args, **_kwargs):
    raise ValueError("This model isn't mapped yet.")


# @scenario "Topic names from a model litellm cannot price are kept"
def test_names_survive_a_pricing_call_that_raises(monkeypatch):
    monkeypatch.setattr(
        litellm, "completion", lambda **_kwargs: named(topic_0="Billing", topic_1="Login")
    )
    # Unpatched litellm raises instead of answering None.
    monkeypatch.setattr(topic_naming, "completion_cost", unpriceable)

    names, cost = topic_naming.generate_topic_names_split(
        {"model": "openai/@cf/deepseek-ai/deepseek-v4.1-flash-1017"},
        topic_examples=[["invoice is wrong"], ["cannot sign in"]],
    )

    assert names == ["Billing", "Login"]
    assert cost["amount"] == 0
