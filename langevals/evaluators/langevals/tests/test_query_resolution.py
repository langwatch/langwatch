import dotenv

dotenv.load_dotenv()

from langevals_core.base_evaluator import ConversationEntry

from langevals_langevals.query_resolution import (
    QueryResolutionEntry,
    QueryResolutionSettings,
    QueryResolutionResult,
    QueryResolutionEvaluator,
)


def test_query_resolution_conversation_evaluator_pass_for_simple_greetings():
    response1 = ConversationEntry(
        input="Hey, how are you?",
        output="Hello, I am an assistant and I don't have feelings",
    )
    conversation = QueryResolutionEntry(conversation=[response1])
    settings = QueryResolutionSettings(model="openai/gpt-5", max_tokens=10000)
    evaluator = QueryResolutionEvaluator(settings=settings)
    result = evaluator.evaluate(conversation)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True
    assert result.details


def test_query_resolution_conversation_evaluator_pass():
    response1 = ConversationEntry(
        input="Hey, how are you?",
    )
    response2 = ConversationEntry(
        input="Okay, is there a president in the Netherlands? Also, tell me what is the system of government in the Netherlands?",
        output="There is no president in the Netherlands. The system of government is constitutional monarchy.",
    )
    conversation = QueryResolutionEntry(conversation=[response1, response2])
    settings = QueryResolutionSettings(model="openai/gpt-5", max_tokens=10000)
    evaluator = QueryResolutionEvaluator(settings=settings)
    result = evaluator.evaluate(conversation)

    assert result.status == "processed"
    assert result.score == 1.0
    assert result.passed == True
    assert result.details


def test_query_resolution_conversation_evaluator_fail():
    response1 = ConversationEntry(
        input="Hey, how are you?",
        output="Hello, I am an assistant and I don't have feelings",
    )
    response2 = ConversationEntry(
        input="Okay, is there a president in the Netherlands? Also, what equals 2 + 2? How many paws does a standard dog have?",
        output="There is no president in the Netherlands.",
    )
    conversation = QueryResolutionEntry(conversation=[response1, response2])
    settings = QueryResolutionSettings(model="openai/gpt-5", max_tokens=10000)
    evaluator = QueryResolutionEvaluator(settings=settings)
    result = evaluator.evaluate(conversation)

    assert result.status == "processed"
    assert result.score < 0.8
    assert result.passed == False
    assert result.details


def test_query_resolution_conversation_evaluator_fails_with_i_dont_know():
    response1 = ConversationEntry(
        input="What time is it?",
        output="Sorry, I don't have any information about the current time",
    )
    conversation = QueryResolutionEntry(conversation=[response1])
    settings = QueryResolutionSettings(model="openai/gpt-5", max_tokens=10000)
    evaluator = QueryResolutionEvaluator(settings=settings)
    result = evaluator.evaluate(conversation)

    assert result.status == "processed"
    assert result.score == 0.0
    assert result.passed == False
    assert result.details


def test_product_sentiment_polarity_evaluator_skipped_for_non_product_related_outputs():
    response1 = ConversationEntry(input="", output="")
    response2 = ConversationEntry(input="", output="")
    conversation = QueryResolutionEntry(conversation=[response1, response2])
    settings = QueryResolutionSettings(model="openai/gpt-5", max_tokens=10000)
    evaluator = QueryResolutionEvaluator(settings=settings)
    result = evaluator.evaluate(conversation)

    assert result.status == "skipped"
