"""Client identity headers for the LangWatch Python SDK.

The platform attributes traffic by these headers (see
``specs/observability/traffic-attribution.feature``): every request the SDK
makes names the SDK, its language and its version, matching the header set
the TypeScript and Go SDKs already send. Older Python SDK versions sent only
``X-LangWatch-SDK-Version``; the platform still counts those as SDK traffic,
but cannot tell which SDK they were.
"""

from __future__ import annotations

from typing import Dict

SDK_NAME = "langwatch-observability-sdk"
SDK_LANGUAGE = "python"


def build_sdk_identity_headers(version: str) -> Dict[str, str]:
    """Build the headers that identify this SDK to the platform."""
    return {
        "User-Agent": f"langwatch-sdk-python/{version}",
        "X-LangWatch-SDK-Name": SDK_NAME,
        "X-LangWatch-SDK-Language": SDK_LANGUAGE,
        "X-LangWatch-SDK-Version": version,
    }
