from langevals_lingua.language_detection import (
    LinguaLanguageDetectionEvaluator,
    LinguaLanguageDetectionEntry,
    LinguaLanguageDetectionSettings,
)


def test_language_detection_evaluator():
    entry = LinguaLanguageDetectionEntry(
        input="hello how is it going my friend? testing",
        output="ola como vai voce eu vou bem obrigado",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(check_for="input_matches_output")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert result.label == "EN"
    assert result.score == 2
    assert (
        result.details
        == "Input and output languages do not match. Input languages detected: EN. Output languages detected: PT"
    )


def test_language_detection_evaluator_specific_language():
    entry = LinguaLanguageDetectionEntry(
        input="hello how is it going my friend? testing",
        output="hello how is it going my friend? testing",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(
            check_for="input_matches_output", expected_language="EN"
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.label == "EN"
    assert result.score == 1
    assert (
        result.details == "Input languages detected: EN. Output languages detected: EN"
    )


def test_language_detection_evaluator_no_language_detected():
    entry = LinguaLanguageDetectionEntry(
        input="small text",
        output="small text",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(
            check_for="input_matches_output", expected_language="EN"
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.details == "Skipped because the input has less than 7 words"


def test_language_detection_evaluator_any_language():
    entry = LinguaLanguageDetectionEntry(
        input="small text",
        output="hello how is it going my friend? testing",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(
            check_for="output_matches_language", expected_language=None
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.label == "EN"
    assert result.passed == True
    assert result.score == 1
    assert result.details == "Languages detected: EN"


def test_language_detection_evaluator_long_context():
    entry = LinguaLanguageDetectionEntry(
        input="lorem ipsum dolor " * 10000,
        output="cogito ergo modus operandi",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(
            check_for="input_matches_output", expected_language=None, min_words=0
        )
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.label == "LA"
    assert result.score == 1
    assert (
        result.details == "Input languages detected: LA. Output languages detected: LA"
    )


def test_detecting_japanese():
    entry = LinguaLanguageDetectionEntry(
        input="自動更新の解約の仕方を教えてください",
        output="自動更新を解約するには、ユーザーのアカウントにログインして、「設定」を選択して、「自動更新」を解約してください。",
    )
    evaluator = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(check_for="input_matches_output")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.label == "JA"
    assert result.score == 1.0
    assert (
        result.details == "Input languages detected: JA. Output languages detected: JA"
    )
