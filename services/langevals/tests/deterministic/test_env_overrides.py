"""Unit tests for the parsers behind the server's env tuning knobs.

`CPU_COUNT`, `WEB_CONCURRENCY`, `LANGEVALS_QUEUE_TIMEOUT` and
`MAX_EVALUATIONS_IN_PARALLEL` are all read while the server boots. A blank
value in a manifest, a typo, or a nonsense number reads as unset and falls
back, never stopping the pod from starting.
"""

import pytest

from langevals.utils import positive_float_or_none, positive_int_or_none


@pytest.mark.parametrize("raw", [None, "", "   ", "abc", "0", "-1", "1.5"])
def test_unusable_int_overrides_read_as_unset(raw):
    assert positive_int_or_none(raw) is None


def test_usable_int_override_is_parsed():
    assert positive_int_or_none("8") == 8


@pytest.mark.parametrize(
    "raw", [None, "", "   ", "abc", "0", "-1", "nan", "inf", "-inf"]
)
def test_unusable_float_overrides_read_as_unset(raw):
    assert positive_float_or_none(raw) is None


def test_usable_float_override_is_parsed():
    assert positive_float_or_none("1.5") == 1.5
    assert positive_float_or_none("300") == 300.0
