"""The name rule on synthetic text: the rule runs for real over hand-made input spans."""

from piidetector.name_rule import RULE_SOURCE, apply_name_rule


def span(text, needle, label="PERSON_NAME", nth=0):
    start = -1
    for _ in range(nth + 1):
        start = text.index(needle, start + 1)
    return {"start": start, "end": start + len(needle), "label": label, "score": 0.9}


def added(text, spans):
    return [
        (text[s["start"] : s["end"]], s["start"])
        for s in apply_name_rule(text, spans)
        if RULE_SOURCE in (s.get("src") or [])
    ]


class TestPropagation:
    # @scenario "A name found once is masked everywhere in the text"
    def test_masks_later_mentions_of_a_found_name(self):
        text = "Lucie Moreau opened the ticket. Later, Lucie asked about Moreau's refund."
        result = added(text, [span(text, "Lucie Moreau")])
        assert ("Lucie", text.index("Lucie", 1)) in result
        assert ("Moreau", text.index("Moreau's")) in result

    # @scenario "A name found once is masked everywhere in the text"
    def test_matches_whole_words_only_and_case_sensitively(self):
        text = "Ana called. Banana and ana are not names; Ana is."
        result = added(text, [span(text, "Ana")])
        assert result == [("Ana", text.index("Ana is"))]

    # @scenario "Common capitalised words are not propagated as names"
    def test_does_not_propagate_titles_or_greeting_words(self):
        text = "Dear Prof Okafor, thanks. Dear team, the Prof will reply. Okafor"
        result = added(text, [span(text, "Dear Prof Okafor")])
        assert ("Okafor", text.rindex("Okafor")) in result
        assert {t for t, _ in result} == {"Okafor"}

    # @scenario "A name in a script without letter case is propagated whole"
    def test_propagates_an_uncased_name_as_a_substring(self):
        text = "王小明发了邮件。请回复王小明。"
        result = added(text, [span(text, "王小明")])
        assert result == [("王小明", text.rindex("王小明"))]

    def test_keeps_input_spans_and_never_duplicates_them(self):
        text = "Ines Duarte and Ines again"
        spans = [span(text, "Ines"), span(text, "Ines", nth=1)]
        result = apply_name_rule(text, spans)
        assert [(s["start"], s["end"]) for s in result] == [(0, 4), (16, 20)]
        assert added(text, spans) == []


class TestLastFirstMerge:
    # @scenario "A name written as Last, First is masked whole"
    def test_extends_a_given_name_over_a_preceding_surname(self):
        text = "Customer: Moreau, Lucie (gold tier)"
        result = added(text, [span(text, "Lucie")])
        assert ("Moreau, Lucie", text.index("Moreau")) in result

    # @scenario "A name written as Last, First is masked whole"
    def test_extends_a_surname_over_a_following_given_name(self):
        text = "Signed: Moreau, Lucie"
        result = added(text, [span(text, "Moreau")])
        assert ("Moreau, Lucie", text.index("Moreau")) in result

    # @scenario "The name rule does not extend a name over another entity"
    def test_does_not_extend_over_a_word_with_another_label(self):
        text = "Lucie, Paris office"
        spans = [span(text, "Lucie"), span(text, "Paris", label="LOCATION")]
        assert all("," not in t for t, _ in added(text, spans))

    def test_does_not_extend_over_a_lowercase_word(self):
        text = "thanks, Lucie"
        assert added(text, [span(text, "Lucie")]) == []
