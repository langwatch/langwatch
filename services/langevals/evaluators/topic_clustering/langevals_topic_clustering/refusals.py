"""Model provider failures that every later call with the same settings repeats."""

import re
from typing import Optional

import litellm

# litellm raises a key it could not find as a server, connection or generic API
# error with the provider's own wording, never as one type of its own. Bedrock
# with no AWS credentials says "Unable to locate credentials" or, on chat, fails
# reading the access key of credentials boto never found.
_MISSING_KEY = re.compile(
    r"missing (?:\w+ )?(?:credentials|api key)"
    r"|unable to locate credentials"
    r"|'NoneType' object has no attribute 'access_key'",
    re.IGNORECASE,
)
_MISSING_KEY_TYPES = (
    litellm.exceptions.AuthenticationError,
    litellm.exceptions.InternalServerError,
    litellm.exceptions.APIConnectionError,
    litellm.exceptions.APIError,
)


def causes(error: BaseException):
    """The error and the errors it was raised from or while handling."""
    seen: set[int] = set()
    current: Optional[BaseException] = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def is_missing_key(error: BaseException) -> bool:
    """True when litellm found no API key for the provider it was asked to call."""
    return any(
        isinstance(cause, _MISSING_KEY_TYPES) and _MISSING_KEY.search(str(cause))
        for cause in causes(error)
    )


def is_auth_refusal(error: BaseException) -> bool:
    """True when the provider has no key or refused the one it was given."""
    return is_missing_key(error) or any(
        isinstance(cause, litellm.exceptions.AuthenticationError)
        for cause in causes(error)
    )
