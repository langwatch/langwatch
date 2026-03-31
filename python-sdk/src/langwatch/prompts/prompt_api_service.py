# src/langwatch/prompts/prompt_api_service.py
"""
API service layer for managing LangWatch prompts via REST API.

This module provides a focused interface for CRUD operations on prompts via API only,
handling API communication, error handling, and response unwrapping.
Uses TypedDict for clean interfaces and from_dict methods for type safety.

This service is responsible only for API operations and does not handle local file loading.
"""
from http import HTTPStatus
from typing import Any, Dict, List, Literal, Optional, TypedDict

from langwatch.generated.langwatch_rest_api_client.types import UNSET, Response
from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.generated.langwatch_rest_api_client.api.default import (
    post_api_prompts,
    put_api_prompts_by_id,
    delete_api_prompts_by_id,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body import (
    PostApiPromptsBody,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_messages_item import (
    PostApiPromptsBodyMessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_inputs_item import (
    PostApiPromptsBodyInputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_outputs_item import (
    PostApiPromptsBodyOutputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_scope import (
    PostApiPromptsBodyScope,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body import (
    PutApiPromptsByIdBody,
    PutApiPromptsByIdBodyScope,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_messages_item import (
    PutApiPromptsByIdBodyMessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_inputs_item import (
    PutApiPromptsByIdBodyInputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_outputs_item import (
    PutApiPromptsByIdBodyOutputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_response_200 import (
    PutApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.delete_api_prompts_by_id_response_200 import (
    DeleteApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_labels_by_label_response_200 import (
    PutApiPromptsByIdLabelsByLabelResponse200,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from .errors import unwrap_response
from .decorators.prompt_service_tracing import prompt_service_tracing
from .types import PromptData, Message, Input, Output, MessageDict, InputDict, OutputDict


class AssignLabelResult(TypedDict):
    config_id: str
    version_id: str
    label: str
    updated_at: str


class PromptApiService:
    """
    API service for managing LangWatch prompts via REST API only.

    Provides CRUD operations for prompts with proper error handling and response
    unwrapping. Uses TypedDict interfaces for clean, type-safe API.

    This service handles only API operations and does not handle local file loading.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient):
        """Initialize the prompt API service with a REST API client."""
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "PromptApiService":
        """Create a PromptApiService instance using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _raw_request(
        self,
        method: str,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        """Make a raw HTTP request via the underlying httpx client.

        Bypasses the generated client's enum types so that arbitrary label
        strings (custom labels) can be passed through to the API.
        """
        httpx_client = self._client.get_httpx_client()
        return httpx_client.request(
            method=method,
            url=url,
            params=params,
            json=json,
            headers=headers or {"Content-Type": "application/json"},
        )

    @prompt_service_tracing.get
    def get(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        label: Optional[str] = None,
    ) -> PromptData:
        """Retrieve a prompt by its ID from the API.

        Uses direct httpx calls instead of the generated client to support
        arbitrary label strings (the generated client restricts labels to an enum).
        """
        params: Dict[str, Any] = {}
        if version_number is not None:
            params["version"] = version_number
        if label is not None:
            params["label"] = label

        raw_resp = self._raw_request(
            method="get",
            url=f"/api/prompts/{prompt_id}",
            params=params,
        )

        if raw_resp.status_code != 200:
            resp = Response(
                status_code=HTTPStatus(raw_resp.status_code),
                content=raw_resp.content,
                headers=raw_resp.headers,
                parsed=None,
            )
            unwrap_response(
                resp,
                ok_type=GetApiPromptsByIdResponse200,
                subject=f'handle_or_id="{prompt_id}"',
                op="fetch",
            )
            raise RuntimeError(
                f"Failed to fetch prompt with handle_or_id={prompt_id}"
            )

        parsed = GetApiPromptsByIdResponse200.from_dict(raw_resp.json())
        return PromptData.from_api_response(parsed)

    def assign_label(
        self,
        prompt_id: str,
        label: str,
        version_id: str,
    ) -> AssignLabelResult:
        """Assign a label to a specific prompt version.

        Uses direct httpx calls to support arbitrary label strings.
        """
        raw_resp = self._raw_request(
            method="put",
            url=f"/api/prompts/{prompt_id}/labels/{label}",
            json={"versionId": version_id},
        )

        if raw_resp.status_code != 200:
            resp = Response(
                status_code=HTTPStatus(raw_resp.status_code),
                content=raw_resp.content,
                headers=raw_resp.headers,
                parsed=None,
            )
            unwrap_response(
                resp,
                ok_type=PutApiPromptsByIdLabelsByLabelResponse200,
                subject=f'id="{prompt_id}" label="{label}"',
                op="assign_label",
            )
            raise RuntimeError(
                f"Failed to assign label '{label}' to prompt '{prompt_id}'"
            )

        data = raw_resp.json()
        return AssignLabelResult(
            config_id=data.get("configId", ""),
            version_id=data.get("versionId", ""),
            label=data.get("label", ""),
            updated_at=data.get("updatedAt", ""),
        )

    def create(
        self,
        handle: str,
        author_id: Optional[str] = None,
        scope: Literal["PROJECT", "ORGANIZATION"] = "PROJECT",
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
        labels: Optional[List[str]] = None,
    ) -> PromptData:
        """Create a new prompt with clean dictionary interfaces.

        When labels are provided, uses direct httpx to bypass the generated
        client's enum restriction on label values.
        """
        api_messages = UNSET
        if messages:
            api_messages = [
                PostApiPromptsBodyMessagesItem.from_dict(msg.model_dump())
                for msg in messages
            ]

        api_inputs = UNSET
        if inputs:
            api_inputs = [
                PostApiPromptsBodyInputsItem.from_dict(inp.model_dump())
                for inp in inputs
            ]

        api_outputs = UNSET
        if outputs:
            api_outputs = [
                PostApiPromptsBodyOutputsItem.from_dict(out.model_dump())
                for out in outputs
            ]

        if labels is not None:
            # Bypass generated enum — build body dict and make raw request
            body_dict: Dict[str, Any] = {
                "handle": handle,
                "scope": scope,
            }
            if author_id:
                body_dict["authorId"] = author_id
            if prompt:
                body_dict["prompt"] = prompt
            if messages:
                body_dict["messages"] = [msg.model_dump() for msg in messages]
            if inputs:
                body_dict["inputs"] = [inp.model_dump() for inp in inputs]
            if outputs:
                body_dict["outputs"] = [out.model_dump() for out in outputs]
            body_dict["labels"] = labels

            raw_resp = self._raw_request(
                method="post",
                url="/api/prompts",
                json=body_dict,
            )
            if raw_resp.status_code != 200:
                resp = Response(
                    status_code=HTTPStatus(raw_resp.status_code),
                    content=raw_resp.content,
                    headers=raw_resp.headers,
                    parsed=None,
                )
                unwrap_response(
                    resp,
                    ok_type=PostApiPromptsResponse200,
                    subject=f'handle="{handle}"',
                    op="create",
                )
                raise RuntimeError(f"Failed to create prompt with handle={handle}")

            parsed = PostApiPromptsResponse200.from_dict(raw_resp.json())
            return PromptData.from_api_response(parsed)
        else:
            resp = post_api_prompts.sync_detailed(
                client=self._client,
                body=PostApiPromptsBody(
                    handle=handle,
                    scope=PostApiPromptsBodyScope(scope),
                    author_id=author_id or UNSET,
                    prompt=prompt or UNSET,
                    messages=api_messages,
                    inputs=api_inputs,
                    outputs=api_outputs,
                ),
            )
            ok = unwrap_response(
                resp,
                ok_type=PostApiPromptsResponse200,
                subject=f'handle="{handle}"',
                op="create",
            )
            if ok is None:
                raise RuntimeError(f"Failed to create prompt with handle={handle}")

            return PromptData.from_api_response(ok)

    def update(
        self,
        prompt_id_or_handle: str,
        scope: Literal["PROJECT", "ORGANIZATION"],
        commit_message: str,
        handle: Optional[str] = None,
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
        labels: Optional[List[str]] = None,
    ) -> PromptData:
        """Update an existing prompt with clean dictionary interfaces.

        When labels are provided, uses direct httpx to bypass the generated
        client's enum restriction on label values.
        """
        api_messages = UNSET
        if messages:
            api_messages = [
                PutApiPromptsByIdBodyMessagesItem.from_dict(msg.model_dump())
                for msg in messages
            ]

        api_inputs = UNSET
        if inputs:
            api_inputs = [
                PutApiPromptsByIdBodyInputsItem.from_dict(inp.model_dump())
                for inp in inputs
            ]

        api_outputs = UNSET
        if outputs:
            api_outputs = [
                PutApiPromptsByIdBodyOutputsItem.from_dict(out.model_dump())
                for out in outputs
            ]

        if labels is not None:
            # Bypass generated enum — build body dict and make raw request
            body_dict: Dict[str, Any] = {
                "commitMessage": commit_message,
                "scope": scope,
            }
            if handle:
                body_dict["handle"] = handle
            if prompt:
                body_dict["prompt"] = prompt
            if messages:
                body_dict["messages"] = [msg.model_dump() for msg in messages]
            if inputs:
                body_dict["inputs"] = [inp.model_dump() for inp in inputs]
            if outputs:
                body_dict["outputs"] = [out.model_dump() for out in outputs]
            body_dict["labels"] = labels

            raw_resp = self._raw_request(
                method="put",
                url=f"/api/prompts/{prompt_id_or_handle}",
                json=body_dict,
            )
            if raw_resp.status_code != 200:
                resp = Response(
                    status_code=HTTPStatus(raw_resp.status_code),
                    content=raw_resp.content,
                    headers=raw_resp.headers,
                    parsed=None,
                )
                unwrap_response(
                    resp,
                    ok_type=PutApiPromptsByIdResponse200,
                    subject=f'id="{prompt_id_or_handle}"',
                    op="update",
                )
                raise RuntimeError(
                    f"Failed to update prompt with id={prompt_id_or_handle}"
                )

            parsed = PutApiPromptsByIdResponse200.from_dict(raw_resp.json())
            return PromptData.from_api_response(parsed)
        else:
            resp = put_api_prompts_by_id.sync_detailed(
                id=prompt_id_or_handle,
                client=self._client,
                body=PutApiPromptsByIdBody(
                    commit_message=commit_message,
                    handle=handle or UNSET,
                    scope=PutApiPromptsByIdBodyScope[scope],
                    prompt=prompt or UNSET,
                    messages=api_messages,
                    inputs=api_inputs,
                    outputs=api_outputs,
                ),
            )

            ok = unwrap_response(
                resp,
                ok_type=PutApiPromptsByIdResponse200,
                subject=f'id="{prompt_id_or_handle}"',
                op="update",
            )
            if ok is None:
                raise RuntimeError(
                    f"Failed to update prompt with id={prompt_id_or_handle}"
                )

            return PromptData.from_api_response(ok)

    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """Delete a prompt by its ID."""
        resp = delete_api_prompts_by_id.sync_detailed(id=prompt_id, client=self._client)
        ok = unwrap_response(
            resp,
            ok_type=DeleteApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="delete",
        )
        if ok is None:
            raise RuntimeError(f"Failed to delete prompt with id={prompt_id}")
        return {"success": bool(ok.success)}
