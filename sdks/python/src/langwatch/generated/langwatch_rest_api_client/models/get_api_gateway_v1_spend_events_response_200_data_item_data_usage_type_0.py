from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0")


@_attrs_define
class GetApiGatewayV1SpendEventsResponse200DataItemDataUsageType0:
    """
    Attributes:
        input_tokens (int):
        output_tokens (int):
        cache_read_input_tokens (int):
        cache_creation_input_tokens (int):
        reasoning_tokens (int):
        input_image_tokens (int): Image tokens billed on the input side, disjoint from input_tokens.
        output_image_tokens (int): Image tokens the answer was billed for, disjoint from output_tokens.
        image_count (int): Images the request carried. Display only: never part of a cost sum.
    """

    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    reasoning_tokens: int
    input_image_tokens: int
    output_image_tokens: int
    image_count: int

    def to_dict(self) -> dict[str, Any]:
        input_tokens = self.input_tokens

        output_tokens = self.output_tokens

        cache_read_input_tokens = self.cache_read_input_tokens

        cache_creation_input_tokens = self.cache_creation_input_tokens

        reasoning_tokens = self.reasoning_tokens

        input_image_tokens = self.input_image_tokens

        output_image_tokens = self.output_image_tokens

        image_count = self.image_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": cache_read_input_tokens,
                "cache_creation_input_tokens": cache_creation_input_tokens,
                "reasoning_tokens": reasoning_tokens,
                "input_image_tokens": input_image_tokens,
                "output_image_tokens": output_image_tokens,
                "image_count": image_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_tokens = d.pop("input_tokens")

        output_tokens = d.pop("output_tokens")

        cache_read_input_tokens = d.pop("cache_read_input_tokens")

        cache_creation_input_tokens = d.pop("cache_creation_input_tokens")

        reasoning_tokens = d.pop("reasoning_tokens")

        input_image_tokens = d.pop("input_image_tokens")

        output_image_tokens = d.pop("output_image_tokens")

        image_count = d.pop("image_count")

        get_api_gateway_v1_spend_events_response_200_data_item_data_usage_type_0 = cls(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            reasoning_tokens=reasoning_tokens,
            input_image_tokens=input_image_tokens,
            output_image_tokens=output_image_tokens,
            image_count=image_count,
        )

        return get_api_gateway_v1_spend_events_response_200_data_item_data_usage_type_0
