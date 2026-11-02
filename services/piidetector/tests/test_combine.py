"""How Level 1 merges its components. Level 0 and the name rule run for real; the models are fakes."""

from fakes import make_gliner, make_tracer

from piidetector import combine


def at(text, needle, label, score=None, nth=0):
    start = -1
    for _ in range(nth + 1):
        start = text.index(needle, start + 1)
    return {"start": start, "end": start + len(needle), "label": label, "score": score}


def view(text, spans):
    return [(text[s["start"] : s["end"]], s["label"], s["source"]) for s in spans]


class TestTracerNames:
    # @scenario "Level 1 keeps only confident Tracer names"
    def test_keeps_tracer_person_names_at_or_above_the_threshold(self):
        text = "Tomasz and Wiktor wrote from tomasz@example.com"
        tracer = [
            at(text, "Tomasz", "PERSON_NAME", combine.TRACER_NAME_MIN_SCORE),
            at(text, "Wiktor", "PERSON_NAME", combine.TRACER_NAME_MIN_SCORE - 0.01),
            at(text, "tomasz@example.com", "EMAIL", 0.99),
        ]
        result = combine.combine_level1(text, {"level0": [], "gliner": [], "tracer": tracer})
        assert [s for s in view(text, result) if s[2] == "tracer"] == [("Tomasz", "PERSON_NAME", "tracer")]
        assert "Wiktor" not in [t for t, _, _ in view(text, result)]

    # @scenario "Level 1 keeps only confident Tracer names"
    def test_keeps_a_tracer_name_without_a_score(self):
        assert combine.tracer_names([{"start": 0, "end": 3, "label": "PERSON_NAME", "score": None}]) != []


class TestUnion:
    # @scenario "A span found by several components is reported once"
    def test_same_span_from_two_components_is_reported_once_with_both_sources(self):
        text = "write to lucie.moreau@example.com"
        email = "lucie.moreau@example.com"
        parts = {
            "level0": [at(text, email, "EMAIL")],
            "gliner": [at(text, email, "EMAIL", 0.7)],
            "tracer": [],
        }
        result = combine.combine_level1(text, parts)
        assert result == [
            {
                "start": text.index(email),
                "end": len(text),
                "label": "EMAIL",
                "score": 0.7,
                "source": "level0+gliner",
            }
        ]

    def test_same_range_with_different_labels_stays_two_spans(self):
        parts = {
            "a": [{"start": 0, "end": 4, "label": "USERNAME", "score": 0.4}],
            "b": [{"start": 0, "end": 4, "label": "PERSON_NAME", "score": 0.3}],
        }
        assert len(combine.union_spans(parts)) == 2

    def test_keeps_the_highest_score(self):
        parts = {
            "a": [{"start": 0, "end": 4, "label": "EMAIL", "score": 0.4}],
            "b": [{"start": 0, "end": 4, "label": "EMAIL", "score": 0.9}],
            "c": [{"start": 0, "end": 4, "label": "EMAIL", "score": 0.5}],
        }
        assert combine.union_spans(parts)[0]["score"] == 0.9
        assert combine.union_spans(parts)[0]["source"] == "a+b+c"


class TestNameRuleOverAllComponents:
    # @scenario "A name only Tracer found is masked everywhere in the text"
    def test_a_tracer_only_name_is_propagated(self):
        text = "Tomasz Nowak called. Tomasz will call again."
        parts = {"level0": [], "gliner": [], "tracer": [at(text, "Tomasz Nowak", "PERSON_NAME", 0.95)]}
        result = combine.combine_level1(text, parts)
        found = [(text[s["start"] : s["end"]], s["start"], s["source"]) for s in result]
        assert ("Tomasz Nowak", 0, "tracer") in found
        assert ("Tomasz", text.rindex("Tomasz"), "name_rule") in found
        # The rule also marks each name word inside the original span; masking covers the same characters.
        assert {s["label"] for s in result} == {"PERSON_NAME"}


class TestLevels:
    def test_level0_runs_without_models(self):
        text = "mail lucie.moreau@example.com"
        assert view(text, combine.detect(text, 0)) == [("lucie.moreau@example.com", "EMAIL", "level0")]

    def test_level1_runs_every_component(self):
        text = "Lucie Moreau (lucie.moreau@example.com) met Tomasz. Lucie left."
        result = view(text, combine.detect(text, 1, gliner=make_gliner(), tracer=make_tracer()))
        assert ("lucie.moreau@example.com", "EMAIL", "level0") in result
        assert ("Lucie", "PERSON_NAME", "gliner") in result
        assert ("Tomasz", "PERSON_NAME", "tracer") in result
        assert ("Moreau", "PERSON_NAME", "name_rule") not in result  # GLiNER's fake finds "Lucie" only

    def test_rejects_an_unknown_level(self):
        import pytest

        with pytest.raises(ValueError):
            combine.detect("text", 2)

    # @scenario "The split layout returns the same spans as one process"
    def test_split_parts_combine_to_the_single_process_answer(self):
        text = "Kowalski, Tomasz wrote to Lucie at lucie.moreau@example.com. Tomasz and Lucie agreed."
        gliner, tracer = make_gliner(), make_tracer()
        first = combine.run_components(text, ["level0", "gliner"], gliner=gliner)
        second = combine.run_components(text, ["tracer"], tracer=tracer)
        assert combine.combine_level1(text, {**first, **second}) == combine.detect(
            text, 1, gliner=gliner, tracer=tracer
        )
        names = [
            t for t, label, _ in view(text, combine.combine_level1(text, {**first, **second})) if label == "PERSON_NAME"
        ]
        assert "Kowalski, Tomasz" in names
