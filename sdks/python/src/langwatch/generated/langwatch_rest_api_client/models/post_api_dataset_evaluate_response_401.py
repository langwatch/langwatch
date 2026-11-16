from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiDatasetEvaluateResponse401")


@_attrs_define
class PostApiDatasetEvaluateResponse401:
    """
    Attributes:
        message (str | Unset): Set when the request was rejected before validation
        error (str | Unset): Set when the body parsed and then failed validation
    """

    message: str | Unset = UNSET
    error: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if message is not UNSET:
            field_dict["message"] = message
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message", UNSET)

        error = d.pop("error", UNSET)

        post_api_dataset_evaluate_response_401 = cls(
            message=message,
            error=error,
        )

        return post_api_dataset_evaluate_response_401
