"""
HTTP node module for dspy workflows.

Wraps the HTTP node executor as a dspy.Module for use in workflow execution.
"""

import asyncio
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

import dspy

from langwatch_nlp.studio.execute.http_node import (
    HttpNodeConfig,
    HttpAuthConfig,
    execute_http_node,
)

T = TypeVar("T")


def run_async_safely(coro: Callable[..., Awaitable[T]], *args: Any, **kwargs: Any) -> T:
    """Run an async function safely from sync context.

    Handles both cases:
    - When called from within an existing event loop (uses asyncer.syncify)
    - When called from sync context without a running loop (uses asyncio.run)

    Args:
        coro: The async function to call
        *args: Positional arguments to pass to the function
        **kwargs: Keyword arguments to pass to the function

    Returns:
        The result of the async function
    """
    try:
        asyncio.get_running_loop()
        # If we're already in an async context, use asyncer to bridge
        import asyncer

        return asyncer.syncify(coro)(*args, **kwargs)
    except RuntimeError:
        # No running loop, create one
        return asyncio.run(coro(*args, **kwargs))


class HttpNode(dspy.Module):
    """DSPy module that executes HTTP requests."""

    def __init__(
        self,
        url: str,
        method: str = "POST",
        body_template: Optional[str] = None,
        output_path: Optional[str] = None,
        auth_type: Optional[str] = None,
        auth_token: Optional[str] = None,
        auth_header: Optional[str] = None,
        auth_value: Optional[str] = None,
        auth_username: Optional[str] = None,
        auth_password: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout_ms: Optional[int] = None,
    ):
        super().__init__()

        # Build auth config if provided
        auth: Optional[HttpAuthConfig] = None
        if auth_type:
            auth = HttpAuthConfig(
                type=auth_type,  # type: ignore
                token=auth_token,
                header=auth_header,
                value=auth_value,
                username=auth_username,
                password=auth_password,
            )

        self.config = HttpNodeConfig(
            url=url,
            method=method,  # type: ignore
            body_template=body_template,
            output_path=output_path,
            auth=auth,
            headers=headers,
            timeout_ms=timeout_ms,
        )

    def forward(self, **kwargs: Any) -> Any:
        """Execute the HTTP request with the given inputs.

        Args:
            **kwargs: Input values for template interpolation

        Returns:
            The extracted output from the HTTP response

        Raises:
            Exception: If the HTTP request fails
        """
        result = run_async_safely(execute_http_node, self.config, kwargs)

        if not result.success:
            raise Exception(result.error or "HTTP request failed")

        return {"output": result.output}
