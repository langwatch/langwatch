"""Whether a span found in a titlecased copy of ALL-CAPS text is a name.

The Presidio evaluator analyses such a copy to recover names the model only
sees in Titlecase. These rules decide which of its new spans to trust.
Measured bounds: specs/evaluators/langevals-presidio-allcaps-person-names.feature
"""

import re
import unicodedata
from itertools import pairwise
from typing import Any

from langevals_presidio.name_words import NAME_WORDS
from spacy.lang.en.stop_words import STOP_WORDS
from spacy.strings import hash_string

# The shape a harvested span needs to be a name and not a titlecased acronym.
MIN_SPAN_WORDS = 2
MIN_NORMALISED_TOKEN_LENGTH = 4

# Any gap may sit inside a name (J. SMITH, JOHN "JACK" WHITFIELD, Robert:
# MILLER) unless it ends a quoted field: a quote beside a colon, comma or
# semicolon, as in "method": "POST", "url" or 'POST', 'url'.
FIELD_END = re.compile(r"[\"'“”‘’]\s*[:,;]|[:,;]\s*[\"'“”‘’]")

# A word reads as a name when its Titlecase form sits this many times nearer
# the top of the frequency-sorted vector table than its lowercase and capital
# forms. Frequency falls roughly as 1/rank, so this is near 1.5x as frequent.
# Pro (1.2x) is not a name; Lee (19x) is.
TITLECASE_RANK_DOMINANCE = 1.5


def _is_upper_letter(character: str) -> bool:
    return character.isalpha() and character.isupper()


def _is_word_char(character: str) -> bool:
    return character.isalnum() or character == "_"


def normalise_allcaps_runs(text: str) -> str:
    """Titlecase every whole-word run of two or more capitals, keeping the length.

    U+0130 (lowercase is two characters) stays as it is, and a run touching a
    letter, digit or underscore (ACME_CORP_LTD) is not a word.
    """
    characters = list(text)
    total = len(characters)
    index = 0
    while index < total:
        starts_word = index == 0 or not _is_word_char(characters[index - 1])
        if not _is_upper_letter(characters[index]) or not starts_word:
            index += 1
            continue

        run_end = index
        while run_end < total and _is_upper_letter(characters[run_end]):
            run_end += 1
        ends_word = run_end == total or not _is_word_char(characters[run_end])

        if run_end - index >= 2 and ends_word:
            for position in range(index + 1, run_end):
                lowered = characters[position].lower()
                if len(lowered) == 1:
                    characters[position] = lowered

        index = max(run_end, index + 1)

    return "".join(characters)


def _word_runs(text: str) -> list[tuple[int, int]]:
    """Every maximal run of word characters, as (start, end) into `text`."""
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, character in enumerate(text):
        if _is_word_char(character):
            if start is None:
                start = index
        elif start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, len(text)))
    return runs


def _rewritten_runs(*, original: str, normalised: str) -> list[tuple[int, int]]:
    """The word runs normalisation changed, as (start, end) into both texts."""
    return [
        (run_start, run_end)
        for run_start, run_end in _word_runs(original)
        if original[run_start:run_end] != normalised[run_start:run_end]
    ]


def has_name_shaped_rewrite(*, original: str, normalised: str) -> bool:
    """A rewritten word of 4+ letters, or two rewritten words side by side.

    The second clause is AMY LEE and VAN DER BERG; a lone short one is the CFO.
    """
    rewritten = _rewritten_runs(original=original, normalised=normalised)
    if any(end - start >= MIN_NORMALISED_TOKEN_LENGTH for start, end in rewritten):
        return True
    return any(
        original[left_end:right_start].isspace()
        for (_, left_end), (right_start, _) in pairwise(rewritten)
    )


def could_hold_a_rewritten_name(*, original: str, normalised: str) -> bool:
    """Whether some span of the text could pass `normalisation_justifies_span`.

    That takes a rewritten word of 4+ letters beside another word, or two
    rewritten words with only whitespace between them (AMY LEE, not TCP/IP).
    A capital word fenced off as its own field ("POST") never makes one.
    """
    runs = _word_runs(original)
    rewritten = {
        (start, end)
        for start, end in runs
        if original[start:end] != normalised[start:end]
    }
    if not rewritten:
        return False

    def rewritten_length(run: tuple[int, int]) -> int:
        return run[1] - run[0] if run in rewritten else 0

    for left, right in pairwise(runs):
        gap = original[left[1] : right[0]]
        if FIELD_END.search(gap):
            continue
        left_length, right_length = rewritten_length(left), rewritten_length(right)
        if left_length and right_length and gap.isspace():
            return True
        if max(left_length, right_length) >= MIN_NORMALISED_TOKEN_LENGTH:
            return True
    return False


def _frequency_rank(vectors: Any, form: str) -> float:
    """The form's row in the frequency-sorted vector table, or infinity if absent.

    Looked up by hash so an unseen word is not added to the shared vocab.
    """
    row = vectors.key2row.get(hash_string(form), -1)
    return float("inf") if row < 0 else float(row)


def _folded(word: str) -> str:
    """Lowercase ASCII, so NGÔ and NGO both read as ngo."""
    decomposed = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _is_known_word(word: str, vectors: Any) -> bool:
    return any(
        _frequency_rank(vectors, form) != float("inf")
        for form in (
            word,
            word.lower(),
            word.upper(),
            word[:1].upper() + word[1:].lower(),
        )
    )


def _is_titlecase_word(word: str, vectors: Any) -> bool:
    """Whether the model's corpus writes `word` mostly in Titlecase, as names are.

    Product words (WIDGET), acronyms (SEPA, API) and everyday words (KEY) are not.
    """
    title = _frequency_rank(vectors, word[:1].upper() + word[1:].lower())
    other = min(
        _frequency_rank(vectors, word.lower()),
        _frequency_rank(vectors, word.upper()),
    )
    return title * TITLECASE_RANK_DOMINANCE < other


def _is_listed_name(word: str) -> bool:
    folded = _folded(word)
    return folded in NAME_WORDS and folded not in STOP_WORDS


def normalisation_justifies_span(
    *, original: str, normalised: str, start: int, end: int, vectors: Any
) -> bool:
    """Whether a span found only after normalisation is shaped and worded like a name.

    It needs one Titlecase word (WHITFIELD), or only listed and unseen words
    (HUNG NGO, CEM TAN). Many listed names are also English words, so beside
    an everyday word they do not count: RAM MODULE and ZORBEX ULTRA are refused.
    """
    span = original[start:end]
    if len(span.split()) < MIN_SPAN_WORDS:
        return False
    if not has_name_shaped_rewrite(original=span, normalised=normalised[start:end]):
        return False
    words = [
        span[word_start:word_end]
        for word_start, word_end in _word_runs(span)
        if span[word_start:word_end].isalpha()
    ]
    if any(_is_titlecase_word(word, vectors) for word in words):
        return True
    return bool(words) and all(
        _is_listed_name(word) or not _is_known_word(word, vectors) for word in words
    )
