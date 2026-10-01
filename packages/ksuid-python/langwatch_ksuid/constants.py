"""Constants used throughout the KSUID library."""

import re
from typing import Final

# Length of decoded KSUID in bytes (timestamp + instance + sequence)
DECODED_LEN: Final[int] = 21

# Length of base62 encoded KSUID payload
ENCODED_LEN: Final[int] = 29

# Regex to match KSUID format: (env_)?resource_encoded
KSUID_REGEX: Final[re.Pattern[str]] = re.compile(
    r"^(?:([a-z\d]+)_)?([a-z\d]+)_([a-zA-Z\d]{29})$"
)

# Regex to validate prefix characters (lowercase letters and digits)
PREFIX_REGEX: Final[re.Pattern[str]] = re.compile(r"^[a-z\d]+$")

# Maximum timestamp value (48 bits)
MAX_TIMESTAMP: Final[int] = (2**48) - 1

# Maximum date: 8921556-12-07T10:44:16Z
MAX_DATE: Final[int] = MAX_TIMESTAMP
