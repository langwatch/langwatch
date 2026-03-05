from langevals_langevals.basic import (
    CustomBasicEvaluator,
    CustomBasicEntry,
    CustomBasicRule,
    CustomBasicSettings,
)


def test_custom_basic_evaluator_contains():
    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[CustomBasicRule(field="output", rule="contains", value="Your")]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True

    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[CustomBasicRule(field="output", rule="contains", value="not found")]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == False


def test_custom_basic_evaluator_not_contains():
    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[
                CustomBasicRule(field="output", rule="not_contains", value="not found")
            ]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True

    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[CustomBasicRule(field="output", rule="not_contains", value="Your")]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == False


def test_custom_basic_evaluator_matches_regex():
    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[
                CustomBasicRule(
                    field="output", rule="matches_regex", value="Your effort is .*"
                )
            ]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True

    entry = CustomBasicEntry(output="According to sources[1] this is a test")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[
                CustomBasicRule(
                    field="output", rule="matches_regex", value="\\[[0-9]+\\]"
                )
            ]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True

    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[
                CustomBasicRule(
                    field="output", rule="matches_regex", value="Your effort is not .*"
                )
            ]
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == False


def test_custom_basic_evaluator_not_matches_regex():
    entry = CustomBasicEntry(output="Your effort is really appreciated!")
    evaluator = CustomBasicEvaluator(
        settings=CustomBasicSettings(
            rules=[
                CustomBasicRule(
                    field="output",
                    rule="not_matches_regex",
                    value="Your effort is not .*",
                )
            ]
        )
    )

    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True
