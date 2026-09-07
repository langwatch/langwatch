from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_llm_calls_item_response import (
        PostApiDspyLogStepsBodyItemLlmCallsItemResponse,
    )


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemLlmCallsItem")


@_attrs_define
class PostApiDspyLogStepsBodyItemLlmCallsItem:
    """
    Attributes:
        field_class_ (str):
        response (PostApiDspyLogStepsBodyItemLlmCallsItemResponse):
        model (None | str | Unset):
        prompt_tokens (float | None | Unset):
        completion_tokens (float | None | Unset):
        cost (float | None | Unset):
    """

    field_class_: str
    response: PostApiDspyLogStepsBodyItemLlmCallsItemResponse
    model: None | str | Unset = UNSET
    prompt_tokens: float | None | Unset = UNSET
    completion_tokens: float | None | Unset = UNSET
    cost: float | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field_class_ = self.field_class_

        response = self.response.to_dict()

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        prompt_tokens: float | None | Unset
        if isinstance(self.prompt_tokens, Unset):
            prompt_tokens = UNSET
        else:
            prompt_tokens = self.prompt_tokens

        completion_tokens: float | None | Unset
        if isinstance(self.completion_tokens, Unset):
            completion_tokens = UNSET
        else:
            completion_tokens = self.completion_tokens

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "__class__": field_class_,
                "response": response,
            }
        )
        if model is not UNSET:
            field_dict["model"] = model
        if prompt_tokens is not UNSET:
            field_dict["prompt_tokens"] = prompt_tokens
        if completion_tokens is not UNSET:
            field_dict["completion_tokens"] = completion_tokens
        if cost is not UNSET:
            field_dict["cost"] = cost

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_llm_calls_item_response import (
            PostApiDspyLogStepsBodyItemLlmCallsItemResponse,
        )

        d = dict(src_dict)
        field_class_ = d.pop("__class__")

        response = PostApiDspyLogStepsBodyItemLlmCallsItemResponse.from_dict(d.pop("response"))

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        def _parse_prompt_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        prompt_tokens = _parse_prompt_tokens(d.pop("prompt_tokens", UNSET))

        def _parse_completion_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        completion_tokens = _parse_completion_tokens(d.pop("completion_tokens", UNSET))

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        post_api_dspy_log_steps_body_item_llm_calls_item = cls(
            field_class_=field_class_,
            response=response,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost=cost,
        )

        return post_api_dspy_log_steps_body_item_llm_calls_item
