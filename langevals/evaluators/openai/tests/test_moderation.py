import dotenv

dotenv.load_dotenv()

from langevals_openai.moderation import (
    OpenAIModerationCategories,
    OpenAIModerationEvaluator,
    OpenAIModerationEntry,
    OpenAIModerationSettings,
)


def test_moderation_safe_input():
    evaluator = OpenAIModerationEvaluator()

    results = evaluator.evaluate_batch(
        data=[
            OpenAIModerationEntry(input="The weather is nice today, let's go for a walk in the park."),
        ]
    )

    assert results[0].status == "processed"
    assert results[0].passed


def test_moderation_unsafe_input():
    evaluator = OpenAIModerationEvaluator()

    results = evaluator.evaluate_batch(
        data=[
            OpenAIModerationEntry(
                input="Enough is enough! I've had it with these motherfuckin' snakes on this motherfuckin' plane!"
            ),
        ]
    )

    assert results[0].status == "processed"
    assert not results[0].passed


def test_moderation_with_ignored_categories():
    settings = OpenAIModerationSettings(
        categories=OpenAIModerationCategories(harassment=False)
    )
    evaluator = OpenAIModerationEvaluator(settings=settings)

    test_input = "fuck you"
    params = [OpenAIModerationEntry(input=test_input)]

    results = evaluator.evaluate_batch(data=params)

    assert results[0].status == "processed"
    assert results[0].passed
    assert results[0].details is None


def test_moderation_long_context():
    settings = OpenAIModerationSettings(categories=OpenAIModerationCategories())
    evaluator = OpenAIModerationEvaluator(settings=settings)

    test_input = "lorem ipsum dolor " * 100_000
    params = [OpenAIModerationEntry(input=test_input)]

    results = evaluator.evaluate_batch(data=params)

    assert results[0].status == "processed"
