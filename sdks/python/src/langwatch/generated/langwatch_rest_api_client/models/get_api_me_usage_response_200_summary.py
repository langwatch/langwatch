from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_me_usage_response_200_summary_most_used_model_type_0 import (
        GetApiMeUsageResponse200SummaryMostUsedModelType0,
    )


T = TypeVar("T", bound="GetApiMeUsageResponse200Summary")


@_attrs_define
class GetApiMeUsageResponse200Summary:
    """
    Attributes:
        spent_usd (float):
        billed_usd (float):
        requests (float):
        prompt_tokens (float):
        completion_tokens (float):
        most_used_model (GetApiMeUsageResponse200SummaryMostUsedModelType0 | None):
    """

    spent_usd: float
    billed_usd: float
    requests: float
    prompt_tokens: float
    completion_tokens: float
    most_used_model: GetApiMeUsageResponse200SummaryMostUsedModelType0 | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_me_usage_response_200_summary_most_used_model_type_0 import (
            GetApiMeUsageResponse200SummaryMostUsedModelType0,
        )

        spent_usd = self.spent_usd

        billed_usd = self.billed_usd

        requests = self.requests

        prompt_tokens = self.prompt_tokens

        completion_tokens = self.completion_tokens

        most_used_model: dict[str, Any] | None
        if isinstance(self.most_used_model, GetApiMeUsageResponse200SummaryMostUsedModelType0):
            most_used_model = self.most_used_model.to_dict()
        else:
            most_used_model = self.most_used_model

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "spentUsd": spent_usd,
                "billedUsd": billed_usd,
                "requests": requests,
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "mostUsedModel": most_used_model,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_me_usage_response_200_summary_most_used_model_type_0 import (
            GetApiMeUsageResponse200SummaryMostUsedModelType0,
        )

        d = dict(src_dict)
        spent_usd = d.pop("spentUsd")

        billed_usd = d.pop("billedUsd")

        requests = d.pop("requests")

        prompt_tokens = d.pop("promptTokens")

        completion_tokens = d.pop("completionTokens")

        def _parse_most_used_model(data: object) -> GetApiMeUsageResponse200SummaryMostUsedModelType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                most_used_model_type_0 = GetApiMeUsageResponse200SummaryMostUsedModelType0.from_dict(data)

                return most_used_model_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiMeUsageResponse200SummaryMostUsedModelType0 | None, data)

        most_used_model = _parse_most_used_model(d.pop("mostUsedModel"))

        get_api_me_usage_response_200_summary = cls(
            spent_usd=spent_usd,
            billed_usd=billed_usd,
            requests=requests,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            most_used_model=most_used_model,
        )

        get_api_me_usage_response_200_summary.additional_properties = d
        return get_api_me_usage_response_200_summary

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
