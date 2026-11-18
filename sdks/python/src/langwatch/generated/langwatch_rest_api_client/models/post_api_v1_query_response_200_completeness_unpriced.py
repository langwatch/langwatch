from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiV1QueryResponse200CompletenessUnpriced")


@_attrs_define
class PostApiV1QueryResponse200CompletenessUnpriced:
    """
    Attributes:
        count (float):
        models (list[str]):
    """

    count: float
    models: list[str]

    def to_dict(self) -> dict[str, Any]:
        count = self.count

        models = self.models

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "count": count,
                "models": models,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        count = d.pop("count")

        models = cast(list[str], d.pop("models"))

        post_api_v1_query_response_200_completeness_unpriced = cls(
            count=count,
            models=models,
        )

        return post_api_v1_query_response_200_completeness_unpriced
