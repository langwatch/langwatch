"""
HTTP node executor for workflow execution.

Supports making HTTP requests with:
- Configurable method (GET, POST, PUT, DELETE, PATCH)
- Body template interpolation with {{variable}} placeholders
- JSONPath extraction for response output
- Authentication: bearer token, api_key (custom header), basic auth
- Custom headers
- Timeout configuration
"""

import re
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

import httpx
from jsonpath_ng import parse as parse_jsonpath
from pydantic import BaseModel


class HttpAuthConfig(BaseModel):
    """Authentication configuration for HTTP node."""

    type: Literal["bearer", "api_key", "basic"]
    # For bearer auth
    token: Optional[str] = None
    # For api_key auth
    header: Optional[str] = None
    value: Optional[str] = None
    # For basic auth
    username: Optional[str] = None
    password: Optional[str] = None


class HttpNodeConfig(BaseModel):
    """Configuration for an HTTP node."""

    url: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] = "POST"
    body_template: Optional[str] = None
    output_path: Optional[str] = None
    auth: Optional[HttpAuthConfig] = None
    headers: Optional[Dict[str, str]] = None
    timeout_ms: Optional[int] = None


@dataclass
class HttpNodeResult:
    """Result from HTTP node execution."""

    success: bool
    output: Optional[Any] = None
    error: Optional[str] = None
    status_code: Optional[int] = None


def interpolate_template(template: str, inputs: Dict[str, Any]) -> str:
    """Replace {{variable}} placeholders with input values.

    String values are JSON-escaped to ensure valid JSON output.
    """
    import json

    def replace_placeholder(match: re.Match[str]) -> str:
        var_name = match.group(1).strip()
        value = inputs.get(var_name, "")
        if isinstance(value, str):
            # JSON-encode then strip outer quotes for embedding in template
            return json.dumps(value)[1:-1]
        # For non-string values, use JSON representation
        return json.dumps(value)

    pattern = r"\{\{([^}]+)\}\}"
    return re.sub(pattern, replace_placeholder, template)


def extract_with_jsonpath(data: Any, path: str) -> Any:
    """Extract value from data using JSONPath expression.

    Raises ValueError if path matches nothing.
    """
    jsonpath_expr = parse_jsonpath(path)
    matches = jsonpath_expr.find(data)

    if not matches:
        raise ValueError(f"JSONPath '{path}' did not match any data")

    # Return single value if only one match, otherwise return list
    if len(matches) == 1:
        return matches[0].value

    return [match.value for match in matches]


def build_headers(config: HttpNodeConfig) -> Dict[str, str]:
    """Build request headers from config including auth."""
    headers: Dict[str, str] = {"Content-Type": "application/json"}

    # Add custom headers
    if config.headers:
        headers.update(config.headers)

    # Add auth headers
    if config.auth:
        if config.auth.type == "bearer" and config.auth.token:
            headers["Authorization"] = f"Bearer {config.auth.token}"
        elif config.auth.type == "api_key" and config.auth.header and config.auth.value:
            headers[config.auth.header] = config.auth.value
        elif config.auth.type == "basic" and config.auth.username and config.auth.password:
            import base64
            credentials = base64.b64encode(
                f"{config.auth.username}:{config.auth.password}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {credentials}"

    return headers


def _is_blocked_url(url: str) -> bool:
    """Check if URL targets localhost or internal networks."""
    from urllib.parse import urlparse
    parsed = urlparse(url.lower())
    hostname = parsed.hostname or ""

    blocked_hosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "[::1]",
    ]

    # Block localhost and loopback
    if hostname in blocked_hosts:
        return True

    # Block internal network ranges (basic check)
    if hostname.startswith("10.") or hostname.startswith("192.168."):
        return True
    if hostname.startswith("172.") and len(hostname) > 4:
        # 172.16.0.0 - 172.31.255.255
        parts = hostname.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            second_octet = int(parts[1])
            if 16 <= second_octet <= 31:
                return True

    return False


async def execute_http_node(
    config: HttpNodeConfig,
    inputs: Dict[str, Any],
) -> HttpNodeResult:
    """Execute an HTTP node with the given configuration and inputs.

    Args:
        config: HTTP node configuration
        inputs: Input values for template interpolation

    Returns:
        HttpNodeResult with success status, output or error
    """
    # Validate URL - block localhost and internal networks
    if _is_blocked_url(config.url):
        return HttpNodeResult(
            success=False,
            error="Blocked URL: requests to localhost and internal networks are not allowed",
        )

    # Build request body
    body: Optional[str] = None
    if config.body_template:
        body = interpolate_template(config.body_template, inputs)

    # Build headers
    headers = build_headers(config)

    # Configure timeout (default 30 seconds)
    timeout_seconds = (config.timeout_ms / 1000) if config.timeout_ms else 30.0

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(
                method=config.method,
                url=config.url,
                headers=headers,
                content=body.encode() if body else None,
            )

            # Check for non-2xx status
            if not (200 <= response.status_code < 300):
                return HttpNodeResult(
                    success=False,
                    error=f"HTTP request failed with status {response.status_code}: {response.text}",
                    status_code=response.status_code,
                )

            # Parse JSON response
            try:
                response_data = response.json()
            except Exception:
                # If response is not JSON, use text
                response_data = response.text

            # Extract output using JSONPath if configured
            if config.output_path:
                try:
                    output = extract_with_jsonpath(response_data, config.output_path)
                except ValueError as e:
                    return HttpNodeResult(
                        success=False,
                        error=f"JSONPath extraction failed: {str(e)}",
                        status_code=response.status_code,
                    )
            else:
                output = response_data

            return HttpNodeResult(
                success=True,
                output=output,
                status_code=response.status_code,
            )

    except httpx.TimeoutException:
        return HttpNodeResult(
            success=False,
            error="HTTP request timeout",
        )
    except httpx.ConnectError as e:
        return HttpNodeResult(
            success=False,
            error=f"Connection error: {str(e)}",
        )
    except httpx.RequestError as e:
        return HttpNodeResult(
            success=False,
            error=f"HTTP request error: {str(e)}",
        )
