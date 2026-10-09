"""Checks the interpreter range the package claims against the one it runs on.

pip does not fail when requires-python excludes the interpreter. It resolves
back to the newest release that does accept it, so a cap one version too low
installs a years-old langwatch and the failure only shows up as a missing
attribute. Running this on every interpreter in the range turns that into a
CI failure on the interpreter that is left out.
"""

import sys
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def _metadata() -> dict:
    with PYPROJECT.open("rb") as file:
        return tomllib.load(file)["project"]


def _bounds() -> tuple[tuple[int, int], tuple[int, int]]:
    """Reads the `>=lower,<upper` pair out of requires-python."""

    lower: tuple[int, int] | None = None
    upper: tuple[int, int] | None = None

    for clause in _metadata()["requires-python"].split(","):
        clause = clause.strip()
        if clause.startswith(">="):
            major, minor = clause[2:].strip().split(".")
            lower = (int(major), int(minor))
        elif clause.startswith("<"):
            major, minor = clause[1:].strip().split(".")
            upper = (int(major), int(minor))

    assert lower is not None, f"no lower bound in {_metadata()['requires-python']}"
    assert upper is not None, f"no upper bound in {_metadata()['requires-python']}"
    return lower, upper


# @scenario "The declared range accepts the interpreter running the tests"
def test_requires_python_accepts_the_running_interpreter():
    lower, upper = _bounds()
    running = sys.version_info[:2]

    assert lower <= running < upper, (
        f"running on Python {running[0]}.{running[1]}, but the package declares "
        f"{_metadata()['requires-python']}. pip would resolve this interpreter to an "
        "older langwatch release instead of failing the install."
    )


# @scenario "Every minor version in the declared range has a classifier"
def test_every_supported_minor_version_has_a_classifier():
    lower, upper = _bounds()
    classifiers = set(_metadata()["classifiers"])

    expected = {
        f"Programming Language :: Python :: {lower[0]}.{minor}"
        for minor in range(lower[1], upper[1])
    }

    assert expected <= classifiers, sorted(expected - classifiers)
