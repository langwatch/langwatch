# Remove @functools.lru_cache for cached_litellm_completion otherwise we get two levels of caching, which is weird, and we
# lose the info if the underlying litellm call is cached or not

import dspy.clients.lm


def cached_litellm_completion_without_lru_cache(*args, **kwargs):
    return dspy.clients.lm.litellm_completion(
        *args, **kwargs, cache={"no-cache": False, "no-store": False}
    )


dspy.clients.lm.cached_litellm_completion = cached_litellm_completion_without_lru_cache
