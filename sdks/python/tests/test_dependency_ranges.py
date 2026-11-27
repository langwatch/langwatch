"""Checks declared dependency ranges against the versions the SDK imports under.

A fresh `pip install langwatch` ignores uv.lock and takes the newest version
a range admits, so an uncapped range ships whatever major lands upstream.
Spec: specs/python-sdk/dependency-ranges.feature
"""

import tomllib
from pathlib import Path

from packaging.requirements import Requirement

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def _requirement(*, name: str) -> Requirement:
    with PYPROJECT.open("rb") as file:
        dependencies = tomllib.load(file)["project"]["dependencies"]
    matches = [Requirement(d) for d in dependencies if Requirement(d).name == name]
    assert len(matches) == 1, f"expected one {name} requirement, got {matches}"
    return matches[0]


# @scenario "The python-liquid range stops below the untested major 3"
def test_python_liquid_range_stops_below_major_3():
    specifier = _requirement(name="python-liquid").specifier

    assert specifier.contains("2.2.1")
    assert specifier.contains("2.3.7")
    assert not specifier.contains("2.2.0")
    assert not specifier.contains("3.0.0")
