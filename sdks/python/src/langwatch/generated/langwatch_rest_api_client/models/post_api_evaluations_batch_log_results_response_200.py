from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiEvaluationsBatchLogResultsResponse200")


@_attrs_define
class PostApiEvaluationsBatchLogResultsResponse200:
    """
    Attributes:
        message (str): Human-readable confirmation
    """

    message: str

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        post_api_evaluations_batch_log_results_response_200 = cls(
            message=message,
        )

        return post_api_evaluations_batch_log_results_response_200
