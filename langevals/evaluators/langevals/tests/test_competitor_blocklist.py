from langevals_langevals.competitor_blocklist import (
    CompetitorBlocklistEvaluator,
    CompetitorBlocklistEntry,
    CompetitorBlocklistSettings,
)


def test_blocklist_evaluator_fail():
    entry = CompetitorBlocklistEntry(
        output="Is Man City better than Arsenal?", input="liverpool"
    )
    settings = CompetitorBlocklistSettings(competitors=["Man City", "Liverpool"])
    evaluator = CompetitorBlocklistEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 2
    assert result.passed == False
    assert result.details == "Competitors mentioned: liverpool, Man City"


def test_blocklist_evaluator_pass():
    entry = CompetitorBlocklistEntry(
        output="Highly likely yes!", input="Is Arsenal winning the EPL this season?"
    )
    settings = CompetitorBlocklistSettings(competitors=["Man City", "Liverpool"])
    evaluator = CompetitorBlocklistEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == True


def test_blocklist_evaluator_lowercase():
    entry = CompetitorBlocklistEntry(
        output="Is Arsenal winning the EPL this season?",
        input="man ciTy is going to win the Champions League",
    )
    settings = CompetitorBlocklistSettings(competitors=["Man City", "Liverpool"])
    evaluator = CompetitorBlocklistEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == False
