"""The name rule: once a document names a person, mask that name everywhere in the document.

`apply_name_rule(text, spans)` takes the spans already found in one text (any labels) and
returns them plus the PERSON_NAME spans the rule adds. Added spans carry `src: ["rule-p"]`
(the rule was called "rule P" in the benchmark that selected it).

Two steps, both over the PERSON_NAME spans in the input:

1. "Last, First" merge. A person span directly preceded by `<Word>, ` or followed by
   `, <Word>`, where <Word> is one capitalised letters-only word (2 to 30 characters), is
   extended over that word, unless the word is already covered by a non-person span.
2. Propagation. Every word of a person span that has at least 3 letters and starts with a
   capital (and is not on the STOP_P list of common capitalised English words) is searched
   in the whole text; each whole-word, case-sensitive match becomes a PERSON_NAME span. For a
   name in a script without letter case (CJK, Thai, Indic and so on) the whole span text of 2
   or more characters is searched as a substring instead.

Existing spans are kept as they are; an added span with the same (start, end, label) as an
existing one is skipped. Overlapping spans are not resolved here.
"""

import re

STOP_P = {
    "The", "This", "That", "These", "Those", "And", "But", "For", "With", "From", "Your", "You", "Our", "His", "Her",
    "Their", "They", "There", "Here", "What", "When", "Where", "Which", "Who", "Why", "How", "Thank", "Thanks", "Hello",
    "Dear", "Best", "Regards", "Sincerely", "Please", "Yes", "Not", "All", "Can", "Could", "Would", "Will", "May",
    "June", "July", "April", "August", "Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Sir", "Madam", "Team", "User",
    "Customer",
}  # fmt: skip

RULE_SOURCE = "rule-p"


def _uncased_script(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and not any(c.isupper() or c.islower() for c in letters)


# One word of letters (any script), 2 to 30 characters, apostrophes and hyphens allowed after the first.
_WORD = r"[^\W\d_][^\W\d_'\-]{1,29}"


def apply_name_rule(text: str, spans: list) -> list:
    persons = [s for s in spans if s.get("label") == "PERSON_NAME"]
    others = [s for s in spans if s.get("label") not in (None, "PERSON_NAME")]
    add = []

    def free(a, b):
        return not any(o["start"] < b and o["end"] > a for o in others)

    # Step 1: merge "Last, First" / "First, Last" by one capitalised word across a comma.
    for sp in persons:
        a, b = sp["start"], sp["end"]
        m = re.search(r"(" + _WORD + r"),[ \t]*$", text[max(0, a - 40) : a])
        if m and m.group(1)[0].isupper():
            s0 = a - (len(text[max(0, a - 40) : a]) - m.start(1))
            if free(s0, a):
                add.append({"start": s0, "end": b, "label": "PERSON_NAME", "score": None, "src": [RULE_SOURCE]})
        m = re.match(r",[ \t]*(" + _WORD + r")", text[b : b + 40])
        if m and m.group(1)[0].isupper():
            e0 = b + m.end(1)
            if free(b, e0):
                add.append({"start": a, "end": e0, "label": "PERSON_NAME", "score": None, "src": [RULE_SOURCE]})
    # Step 2: propagate name words inside the same document.
    needles = set()
    for sp in persons:
        t = text[sp["start"] : sp["end"]].strip()
        if _uncased_script(t):
            if len(t) >= 2:
                needles.add(("sub", t))
            continue
        for tok in re.split(r"[\s,]+", t):
            tok = tok.strip(".'\"()")
            if len(tok) >= 3 and tok[0].isupper() and tok not in STOP_P and all(c.isalpha() or c in "-'" for c in tok):
                needles.add(("word", tok))
    for kind, n in needles:
        pat = re.escape(n) if kind == "sub" else r"(?<![^\W\d_])" + re.escape(n) + r"(?![^\W\d_])"
        for m in re.finditer(pat, text):
            add.append(
                {"start": m.start(), "end": m.end(), "label": "PERSON_NAME", "score": None, "src": [RULE_SOURCE]}
            )
    return _merge(spans, add)


def _merge(spans, add):
    seen = {(s["start"], s["end"], s.get("label")) for s in spans}
    out = list(spans)
    for s in add:
        k = (s["start"], s["end"], s["label"])
        if k not in seen:
            seen.add(k)
            out.append(s)
    return sorted(out, key=lambda s: (s["start"], s["end"], str(s.get("label"))))
