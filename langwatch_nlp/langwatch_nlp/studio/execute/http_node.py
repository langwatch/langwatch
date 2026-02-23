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
    """Replace {{variable}} placeholders with input values using Liquid templates.

    For JSON body templates:
    - String values are JSON-escaped (without outer quotes) so they can be safely
      embedded inside JSON strings: {"foo": "{{input}}"} works with special chars
    - Non-string values (arrays, dicts) are JSON stringified so they can be
      embedded directly: {"foo": {{messages}}} works with arrays/objects

    Examples:
        input='hello "world"' + template='{"x": "{{input}}"}' → '{"x": "hello \\"world\\""}'
        messages=[{"role": "user"}] + template='{"x": {{messages}}}' → '{"x": [{"role": "user"}]}'
    """
    import json
    import liquid
    from langwatch_nlp.studio.utils import SerializableWithStringFallback
    str_inputs: Dict[str, str] = {}
    for k, v in inputs.items():
        if isinstance(v, str):
            # JSON-encode then strip outer quotes for safe embedding in JSON strings
            # This escapes quotes, newlines, etc.
            str_inputs[k] = json.dumps(v, ensure_ascii=False)[1:-1]
        else:
            # For arrays/dicts, JSON stringify for direct embedding
            str_inputs[k] = json.dumps(v, cls=SerializableWithStringFallback, ensure_ascii=False)

    result = liquid.render(template, **str_inputs)

    return result


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


def _is_private_ip(ip: str) -> bool:
    """Check if an IP address is private/internal."""
    import ipaddress
    try:
        ip_obj = ipaddress.ip_address(ip)
        # Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        # Loopback: 127.0.0.0/8
        # Link-local: 169.254.0.0/16
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local
    except ValueError:
        return False


def _is_metadata_endpoint(hostname: str) -> bool:
    """Check if hostname is a cloud metadata endpoint.

    These are ALWAYS blocked regardless of environment.
    """
    # Cloud metadata IPs and hostnames
    metadata_hosts = [
        "169.254.169.254",  # AWS, GCP, Azure metadata
        "metadata.google.internal",  # GCP
        "metadata.goog",  # GCP
        "metadata",  # Generic
    ]
    return hostname.lower() in metadata_hosts


def _is_blocked_url(url: str) -> bool:
    """Check if URL targets localhost or internal networks.

    SSRF Protection:
    - ALWAYS blocks cloud metadata endpoints (169.254.169.254, etc.)
    - In production: blocks private IPs, localhost, internal networks
    - In development: allows hosts listed in ALLOWED_PROXY_HOSTS env var

    DNS rebinding protection: resolves hostname and checks the IP.
    """
    import os
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(url.lower())
    hostname = parsed.hostname or ""

    # ALWAYS block metadata endpoints - no exceptions
    if _is_metadata_endpoint(hostname):
        return True

    # Check if host is in allowed list (for development)
    allowed_hosts_str = os.environ.get("ALLOWED_PROXY_HOSTS", "")
    allowed_hosts = [h.strip().lower() for h in allowed_hosts_str.split(",") if h.strip()]

    if hostname in allowed_hosts:
        return False  # Explicitly allowed

    # Block common localhost variants
    blocked_hosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "[::1]",
    ]

    if hostname in blocked_hosts:
        return True

    # Check if hostname looks like an IP address
    if _is_private_ip(hostname):
        return True

    # DNS rebinding protection: resolve hostname and check the IP
    try:
        resolved_ips = socket.gethostbyname_ex(hostname)[2]
        for ip in resolved_ips:
            if _is_private_ip(ip) or _is_metadata_endpoint(ip):
                return True
    except socket.gaierror:
        # DNS resolution failed - let the actual request fail
        pass

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
    # DEBUG: Log inputs received by HTTP node
    print(f"[DEBUG] execute_http_node - inputs: {inputs}")
    print(f"[DEBUG] execute_http_node - config.body_template: {config.body_template}")

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

    # Configure timeout (default 5 minutes for slow RAG agents)
    timeout_seconds = (config.timeout_ms / 1000) if config.timeout_ms else 300.0

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
                # Include request body in error for debugging
                error_msg = f"HTTP request failed with status {response.status_code}: {response.text}"
                if body:
                    error_msg += f"\n\nRequest body sent:\n{body}"
                return HttpNodeResult(
                    success=False,
                    error=error_msg,
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
