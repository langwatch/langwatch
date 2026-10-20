"""The typed 4xx answers both clustering endpoints give a failure the customer fixes."""

from typing import Optional

import litellm
from fastapi import HTTPException


def configured_model(litellm_params: dict, deployment_name: Optional[str]) -> str:
    """The model to cluster with, or a 422 when none is configured."""
    model = litellm_params.get("model")
    if not model:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "model_not_configured",
                "message": "No model is configured for topic clustering.",
            },
        )
    if model.startswith("azure/") and deployment_name:
        return f"azure/{deployment_name}"
    return model


def customer_failure(error: Exception) -> Optional[HTTPException]:
    """The 4xx a failure the customer fixes answers with, or None when it is ours.

    The detail carries a stable code and fixed copy, never the provider's own
    words: those can quote part of the key that was refused.
    """
    if isinstance(error, litellm.exceptions.AuthenticationError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "model_provider_auth_failed",
                "message": "The model provider refused the configured API key.",
            },
        )
    if isinstance(error, litellm.exceptions.RateLimitError):
        return HTTPException(
            status_code=429,
            detail={
                "code": "model_provider_rate_limited",
                "message": "The model provider is rate limiting or out of quota for the configured key.",
            },
        )
    if isinstance(error, litellm.exceptions.BadRequestError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "model_provider_bad_request",
                "message": "The model provider rejected the request for the configured model.",
            },
        )
    return None


def failure_answer(error: Exception, logger, mode: str) -> HTTPException:
    """The HTTP answer for a clustering run that raised, logged at its level."""
    if isinstance(error, HTTPException):
        logger.warning(f"{mode} clustering refused", status_code=error.status_code, detail=error.detail)
        return error
    refusal = customer_failure(error)
    if refusal is not None:
        logger.warning(
            f"{mode} clustering refused by the model provider",
            status_code=refusal.status_code,
            error_type=type(error).__name__,
        )
        return refusal
    logger.error(f"{mode} clustering failed", error=str(error), error_type=type(error).__name__)
    return HTTPException(status_code=500, detail=f"{mode} clustering failed")
