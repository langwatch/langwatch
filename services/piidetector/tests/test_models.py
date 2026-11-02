"""The model wrappers' own logic (windowing, offsets, label mapping, merging) around fake libraries."""

from fakes import make_gliner, make_tracer

from piidetector import models


class TestGliner:
    def test_sends_the_33_label_prompts_in_two_calls(self):
        g = make_gliner()
        assert len(g.prompts) == 33
        result = g.predict("hello Lucie there")
        assert [c["labels"] for c in g.model.calls] == [25, 8]
        assert g.model.calls[0]["threshold"] == models.GLINER_THRESHOLD
        assert g.model.calls[0]["flat_ner"] is True
        assert result == [{"start": 6, "end": 11, "label": "PERSON_NAME", "score": 0.5}]

    # @scenario "Long texts are windowed and the offsets point into the whole text"
    def test_long_text_is_windowed_and_offsets_map_back(self):
        g = make_gliner()
        text = " ".join(["word"] * 1000) + " Lucie"
        windows = g.windows(text)
        assert windows[0][0] == 0
        assert len(windows) > 2
        assert windows[-1][1] == len(text)
        result = g.predict(text)
        assert len(result) == 1
        assert text[result[0]["start"] : result[0]["end"]] == "Lucie"

    # @scenario "Long texts are windowed and the offsets point into the whole text"
    def test_a_name_inside_the_window_overlap_is_reported_once(self):
        g = make_gliner()
        # Word 350 sits in the overlap of the first two windows (words 0-383 and 320-703).
        tokens = ["word"] * 700
        tokens[350] = "Lucie"
        text = " ".join(tokens)
        assert len(g.predict(text)) == 1

    def test_blank_text_returns_nothing(self):
        assert make_gliner().predict("   ") == []


class TestTracer:
    # @scenario "Long texts are windowed and the offsets point into the whole text"
    def test_long_text_is_windowed_and_labels_are_mapped(self):
        t = make_tracer()
        text = " ".join(["x"] * 5000) + " Tomasz"
        result = t.predict(text)
        assert len(result) == 1
        assert text[result[0]["start"] : result[0]["end"]] == "Tomasz"
        assert result[0]["label"] == "PERSON_NAME"

    def test_short_text_is_one_call(self):
        assert make_tracer().predict("Tomasz wrote") == [{"start": 0, "end": 6, "label": "PERSON_NAME", "score": 0.95}]

    def test_blank_text_returns_nothing(self):
        assert make_tracer().predict("") == []


class TestMergeHighestScore:
    def test_keeps_the_higher_score_where_spans_overlap(self):
        spans = [
            {"start": 0, "end": 5, "label": "A", "score": 0.4},
            {"start": 3, "end": 8, "label": "B", "score": 0.9},
            {"start": 10, "end": 12, "label": "C", "score": 0.1},
        ]
        assert [s["label"] for s in models.merge_highest_score(spans)] == ["B", "C"]

    def test_a_missing_score_counts_as_certain(self):
        spans = [
            {"start": 0, "end": 5, "label": "A", "score": 0.99},
            {"start": 0, "end": 5, "label": "B", "score": None},
        ]
        assert [s["label"] for s in models.merge_highest_score(spans)] == ["B"]
