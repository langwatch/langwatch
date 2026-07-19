import dotenv

dotenv.load_dotenv()

from langevals_azure.content_safety import (
    AzureContentSafetyCategories,
    AzureContentSafetyEvaluator,
    AzureContentSafetyEntry,
    AzureContentSafetySettings,
)


def test_content_safety_integration():
    settings = AzureContentSafetySettings()
    evaluator = AzureContentSafetyEvaluator(settings=settings)

    safe_input = AzureContentSafetyEntry(input="Hello, world!")
    unsafe_input = AzureContentSafetyEntry(
        input="Enough is enough! I've had it with these motherfuckin' snakes on this motherfuckin' plane!"
    )

    safe_result = evaluator.evaluate(safe_input)
    unsafe_result = evaluator.evaluate(unsafe_input)

    assert safe_result.status == "processed"
    assert safe_result.passed
    assert safe_result.details is None

    assert unsafe_result.status == "processed"
    assert not unsafe_result.passed
    assert unsafe_result.details is not None


def test_content_safety_with_custom_settings():
    settings = AzureContentSafetySettings(
        severity_threshold=1,
        categories=AzureContentSafetyCategories(
            Hate=False, SelfHarm=True, Sexual=True, Violence=True
        ),
        output_type="EightSeverityLevels",
    )
    evaluator = AzureContentSafetyEvaluator(settings=settings)

    input_text = "Enough is enough! I've had it with these motherfuckin' snakes on this motherfuckin' plane!"
    params = AzureContentSafetyEntry(input=input_text)

    result = evaluator.evaluate(params)

    assert result.status == "processed"
    assert result.passed
    assert result.details is None


def test_content_safety_with_severity_threshold():
    settings = AzureContentSafetySettings(severity_threshold=4)
    evaluator = AzureContentSafetyEvaluator(settings=settings)

    input_text = "Enough is enough! I've had it with these motherfuckin' snakes on this motherfuckin' plane!"
    params = AzureContentSafetyEntry(input=input_text)

    result = evaluator.evaluate(params)

    assert result.status == "processed"
    assert result.passed
    assert result.details is None


def test_content_safety_long_input():
    evaluator = AzureContentSafetyEvaluator()

    input_text = "lorem ipsum dolor " * 1000
    params = AzureContentSafetyEntry(input=input_text)

    result = evaluator.evaluate(params)

    assert result.status == "processed"
    assert result.passed
    assert result.details is None
