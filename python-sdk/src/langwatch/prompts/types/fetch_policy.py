from enum import Enum


class FetchPolicy(Enum):
    """
    Fetch policy for prompt retrieval.

    Controls how prompts are fetched and cached.
    """

    # Use local file if available, otherwise fetch from API (default)
    MATERIALIZED_FIRST = "MATERIALIZED_FIRST"

    # Always try API first, fall back to materialized
    ALWAYS_FETCH = "ALWAYS_FETCH"

    # Fetch every X minutes, use materialized between fetches
    CACHE_TTL = "CACHE_TTL"

    # Never fetch, use materialized files only
    MATERIALIZED_ONLY = "MATERIALIZED_ONLY"


__all__ = [
    "FetchPolicy",
]
