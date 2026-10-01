"""Fitting a judge's content to its token budget, keeping both ends.

Spec: specs/evaluators/langevals-judge-long-content.feature
"""

import litellm
import pytest

from langevals_core.base_evaluator import EvaluationResultSkipped
from langevals_core.token_budget import (
    FittedContent,
    count_tokens,
    cut_keeping_ends,
    fit_judge_content,
    judge_token_budget,
)

MODEL = "openai/gpt-5-mini"
OPENING = "OPENING: the user asks for a refund on order 1234."
ENDING = "ENDING: the agent confirms the refund was issued."


def long_output(filler_lines: int) -> str:
    filler = "\n".join(f"turn {i}: the agent looks up the order again." for i in range(filler_lines))
    return f"{OPENING}\n{filler}\n{ENDING}"


# @scenario "Content over the budget is judged with its middle cut"
def test_cut_keeps_both_ends_and_names_what_was_left_out():
    text = long_output(3000)

    cut, omitted = cut_keeping_ends(MODEL, text, 2000)

    assert cut.startswith(OPENING)
    assert cut.endswith(ENDING)
    assert f"[... {omitted} tokens omitted from the middle to fit the length limit ...]" in cut
    assert count_tokens(MODEL, cut) <= 2000
    assert omitted > count_tokens(MODEL, text) - 2000 - 50


# @scenario "Content over the budget is judged with its middle cut"
def test_fitted_content_fits_the_budget_with_the_prompt():
    prompt = "Return false if the agent never confirmed the refund."

    fitted = fit_judge_content(
        model=MODEL, max_tokens=4000, reserved_texts=[prompt, prompt], output=long_output(5000)
    )

    assert isinstance(fitted, FittedContent)
    assert fitted.output is not None and fitted.output.endswith(ENDING)
    total = count_tokens(MODEL, prompt) * 2 + count_tokens(MODEL, fitted.output)
    assert total <= 4000
    assert fitted.note() == (
        f"{fitted.omitted_tokens} tokens were omitted from the middle of the content "
        "to fit the maximum of 4000 tokens."
    )


# @scenario "Short fields stay whole and the long ones share what is left"
def test_short_fields_stay_whole():
    contexts = ["Refunds are issued within 5 days.", long_output(2000)]

    fitted = fit_judge_content(
        model=MODEL,
        max_tokens=3000,
        reserved_texts=["judge"],
        input="Where is my refund?",
        output=long_output(4000),
        contexts=contexts,
    )

    assert isinstance(fitted, FittedContent)
    assert fitted.input == "Where is my refund?"
    assert fitted.contexts is not None
    assert fitted.contexts[0] == contexts[0]
    assert "omitted from the middle" in fitted.contexts[1]
    assert fitted.output is not None and "omitted from the middle" in fitted.output


# @scenario "Content within the budget reaches the judge unchanged"
def test_content_within_the_budget_is_unchanged():
    fitted = fit_judge_content(
        model=MODEL,
        max_tokens=128_000,
        reserved_texts=["judge"],
        input="Where is my refund?",
        output="It was issued yesterday.",
        contexts=["Refunds take 5 days."],
    )

    assert isinstance(fitted, FittedContent)
    assert (fitted.input, fitted.output, fitted.contexts) == (
        "Where is my refund?",
        "It was issued yesterday.",
        ["Refunds take 5 days."],
    )
    assert fitted.note() is None
    assert fitted.with_note("reasoning") == "reasoning"


def test_an_image_reference_is_never_cut():
    image = "data:image/png;base64," + "A" * 400_000

    fitted = fit_judge_content(
        model=MODEL, max_tokens=2000, reserved_texts=["judge"], input=image, output="A cat."
    )

    assert isinstance(fitted, FittedContent)
    assert fitted.input == image


# @scenario "The budget is the smaller of the setting and the model's input window"
def test_budget_is_capped_by_the_model_input_window(monkeypatch):
    monkeypatch.setattr(litellm, "get_model_info", lambda model: {"max_input_tokens": 20_000})

    assert judge_token_budget(MODEL, 128_000) == 20_000 - 8_192
    fitted = fit_judge_content(
        model=MODEL, max_tokens=128_000, reserved_texts=["judge"], output=long_output(8000)
    )
    assert isinstance(fitted, FittedContent)
    assert fitted.budget == 20_000 - 8_192
    assert fitted.output is not None and count_tokens(MODEL, fitted.output) <= fitted.budget


def test_unknown_model_keeps_the_setting(monkeypatch):
    def unknown(model):
        raise Exception("This model isn't mapped yet")

    monkeypatch.setattr(litellm, "get_model_info", unknown)

    assert judge_token_budget("custom/judge", 50_000) == 50_000


# @scenario "A prompt that leaves no room for content is skipped with the reason"
def test_prompt_that_fills_the_budget_is_skipped_with_the_numbers():
    prompt = "Judge carefully. " * 400

    skipped = fit_judge_content(
        model=MODEL, max_tokens=1000, reserved_texts=[prompt], output="The refund was issued."
        * 100
    )

    assert isinstance(skipped, EvaluationResultSkipped)
    reserved = count_tokens(MODEL, prompt)
    assert skipped.details == (
        f"The evaluator prompt takes {reserved} tokens, which leaves no room "
        "for the content within the maximum of 1000 tokens."
    )


@pytest.mark.parametrize("budget", [40, 100])
def test_tiny_budgets_keep_the_head_and_still_fit(budget):
    cut, omitted = cut_keeping_ends(MODEL, long_output(500), budget)

    assert count_tokens(MODEL, cut) <= budget
    assert omitted > 0


# @scenario "Short fields stay whole and the long ones share what is left"
def test_many_small_contexts_keep_whole_ones_from_both_ends():
    contexts = [f"Context {i}: London is the capital of France." for i in range(300)]

    fitted = fit_judge_content(
        model=MODEL,
        max_tokens=2048,
        reserved_texts=["judge"],
        input="What is the capital of France?",
        contexts=contexts,
    )

    assert isinstance(fitted, FittedContent)
    assert fitted.input == "What is the capital of France?"
    assert fitted.contexts is not None
    assert fitted.contexts[0] == contexts[0]
    assert fitted.contexts[-1] == contexts[-1]
    markers = [c for c in fitted.contexts if "omitted from the middle" in c]
    assert len(markers) == 1
    assert set(fitted.contexts) - set(markers) <= set(contexts)
    sent = sum(count_tokens(MODEL, c) + 4 for c in fitted.contexts)
    assert sent + count_tokens(MODEL, "judge") <= 2048
