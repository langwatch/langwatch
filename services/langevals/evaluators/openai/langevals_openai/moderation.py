import time
from typing import Literal, Optional
from pydantic import BaseModel, Field
from openai import APITimeoutError, OpenAI

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    BatchEvaluationResult,
    EvaluatorEntry,
    EvaluationResultError,
    EvaluationResultSkipped,
    evaluation_timed_out_result,
)
from tqdm.auto import tqdm


class _DeadlinePassed(Exception):
    """The batch ran out of time before this call could be made."""


def _moderate(client: OpenAI, contents: list[str], deadline: Optional[float]):
    """One moderation call, bounded by whatever is left of the batch deadline.

    Both calls this evaluator makes cover the whole batch, so the budget is
    read again before each one rather than split in half up front: the second
    call gets whatever the first did not spend.
    """
    if deadline is None:
        return client.moderations.create(input=contents)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _DeadlinePassed()
    return client.with_options(timeout=remaining).moderations.create(input=contents)


class OpenAIModerationEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class OpenAIModerationCategories(BaseModel):
    harassment: bool = True
    harassment_threatening: bool = True
    hate: bool = True
    hate_threatening: bool = True
    self_harm: bool = True
    self_harm_instructions: bool = True
    self_harm_intent: bool = True
    sexual: bool = True
    sexual_minors: bool = True
    violence: bool = True
    violence_graphic: bool = True


class OpenAIModerationSettings(EvaluatorSettings):
    model: Literal["text-moderation-stable", "text-moderation-latest"] = Field(
        default="text-moderation-stable",
        description="The model version to use, `text-moderation-latest` will be automatically upgraded over time, while `text-moderation-stable` will only be updated with advanced notice by OpenAI.",
    )
    categories: OpenAIModerationCategories = Field(
        default=OpenAIModerationCategories(),
        description="The categories of content to check for moderation.",
    )


class OpenAIModerationResult(EvaluationResult):
    passed: Optional[bool] = Field(
        description="Fails if any moderation category is flagged",
        default=None,
    )
    score: float = Field(
        description="The model's confidence on primary category where the input violates the OpenAI's policy. The value is between 0 and 1, where higher values denote higher confidence."
    )


class OpenAIModerationEvaluator(
    BaseEvaluator[
        OpenAIModerationEntry, OpenAIModerationSettings, OpenAIModerationResult
    ]
):
    """
    This evaluator uses OpenAI's moderation API to detect potentially harmful content in text,
    including harassment, hate speech, self-harm, sexual content, and violence.
    """

    name = "OpenAI Moderation"
    category = "safety"
    env_vars = ["OPENAI_API_KEY"]
    default_settings = OpenAIModerationSettings()
    docs_url = "https://platform.openai.com/docs/guides/moderation/overview"
    is_guardrail = True

    def evaluate_batch(
        self,
        data: list[OpenAIModerationEntry],
        index=0,
        # The server calls every evaluator through the base signature. This
        # one sends the whole batch in two moderation calls rather than one
        # call per entry, so the per-entry knobs have nothing to act on here:
        # they are accepted so the call works, and ignored.
        max_evaluations_in_parallel=50,
        retries=3,
        max_seconds=None,
        _executor_ref=None,
    ) -> BatchEvaluationResult:
        # `max_seconds` bounds the whole batch, and this override has to keep
        # that promise itself: it never reaches the base class, which is where
        # the deadline usually lives. A moderation call over the network can
        # stall for as long as the socket stays open, and the caller holds a
        # gate slot the whole time, so an unbounded call here is the wedge the
        # deadline exists to stop.
        # An empty batch has nothing to moderate. Calling the provider with an
        # empty input list spends a request the API rejects, and the base class
        # answers [] for the same case.
        if not data:
            return []

        deadline = None if max_seconds is None else time.monotonic() + max_seconds
        # No SDK retries: each attempt gets the full timeout, so the default of
        # two would let one call run for three times the budget.
        client = OpenAI(api_key=self.get_env("OPENAI_API_KEY"), max_retries=0)

        results: list[SingleEvaluationResult] = []

        contents_input = [entry.input or "" for entry in data]
        contents_output = [entry.output or "" for entry in data]
        try:
            response_input = _moderate(client, contents_input, deadline)
            response_output = _moderate(client, contents_output, deadline)
        except (APITimeoutError, _DeadlinePassed):
            # Both calls cover the whole batch, so when either runs out of
            # time no entry has an answer.
            return [evaluation_timed_out_result(max_seconds)] * len(data)

        # The same for every entry, so it is read once rather than per entry.
        enabled_categories = self.settings.categories.model_dump()

        for i, (input_result, output_result) in enumerate(
            zip(response_input.results, response_output.results)
        ):
            if not contents_input[i] and not contents_output[i]:
                results.append(
                    EvaluationResultSkipped(details="Input and output are both empty")
                )
                continue

            # Combine results by taking the maximum scores for each category
            input_scores = input_result.category_scores.model_dump()
            output_scores = output_result.category_scores.model_dump()
            combined_category_scores = {
                category: max(
                    input_scores.get(category, 0),
                    output_scores.get(category, 0),
                )
                for category in enabled_categories.keys()
            }

            detected_categories = {
                category: score > 0.5  # You may want to adjust this threshold
                for category, score in combined_category_scores.items()
                if enabled_categories.get(category, False)
            }

            highest_categories = sorted(
                combined_category_scores.items(),
                key=lambda x: x[1],
                reverse=True,
            )
            score = (
                max(combined_category_scores.values())
                if combined_category_scores
                else 0
            )

            passed = not any(detected_categories.values())

            details = (
                (
                    "Detected "
                    + ", ".join(
                        [
                            f"{category} ({score * 100:.2f}% confidence)"
                            for category, score in highest_categories
                            if detected_categories.get(category, False)
                        ]
                    )
                )
                if not passed
                else None
            )

            results.append(
                OpenAIModerationResult(score=score, passed=passed, details=details)
            )

        # `zip` stops at the shorter list, so a provider answer with fewer
        # results than entries would return a short list and every caller
        # reading answers by position would read them against the wrong entries.
        # Every entry gets an answer, and one the provider did not cover says so.
        while len(results) < len(data):
            results.append(
                EvaluationResultError(
                    error_type="ModerationResultMissing",
                    details=(
                        "The moderation API answered fewer entries than were "
                        "sent, so this entry has no result."
                    ),
                    traceback=[],
                )
            )

        return results
