import dotenv
import pytest

from langevals_langevals.competitor_llm_function_call import (
    CompetitorLLMFunctionCallEvaluator,
    CompetitorLLMFunctionCallEntry,
    CompetitorLLMFunctionCallSettings,
)

dotenv.load_dotenv()

run_counter = 0


def test_competitor_llm_evaluator():

    entry = CompetitorLLMFunctionCallEntry(
        input="Do you like apples?"
    )
    settings = CompetitorLLMFunctionCallSettings(
        name="YouTube",
        description="Video broadcasting platform",
        competitors=["Vimeo", "Spotify", "Apple Podcasts"]
    )
    evaluator = CompetitorLLMFunctionCallEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.score >= 0.5

    assert result.cost
    assert result.cost.amount > 0


def test_competitor_llm_evaluator_pass():
    entry = CompetitorLLMFunctionCallEntry(input="How many videos are stored on YouTube?")
    settings = CompetitorLLMFunctionCallSettings(
        name="YouTube", description="Video brodcasting platform", competitors=["Vimeo", "Spotify", "Apple Podcasts"]
    )
    evaluator = CompetitorLLMFunctionCallEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.score >= 0.5

    assert result.cost
    assert result.cost.amount > 0



def test_competitor_llm_evaluator_fail():
    entry = CompetitorLLMFunctionCallEntry(output="Is YouTube bigger than Vimeo?")
    settings = CompetitorLLMFunctionCallSettings(
        name="YouTube",
        description="Video brodcasting platform",
        competitors=["Vimeo", "Spotify", "Apple Podcasts"]
    )
    evaluator = CompetitorLLMFunctionCallEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert result.score >= 0.5

    assert result.cost
    assert result.cost.amount > 0


def test_competitor_llm_evaluator_default():
    entry = CompetitorLLMFunctionCallEntry(input="", output="")
    settings = CompetitorLLMFunctionCallSettings()
    evaluator = CompetitorLLMFunctionCallEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "skipped"