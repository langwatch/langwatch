from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiExperimentInitResponse403")


@_attrs_define
class PostApiExperimentInitResponse403:
    """
    Attributes:
        error (str): Stable failure code; branch on this
        message (str | Unset):
        fault (str | Unset): Who the failure is attributable to: customer, platform, provider
        tips (list[str] | Unset):
        docs_url (str | Unset):
        limit_type (str | Unset): Which plan limit was reached, on resource_limit_exceeded
        current (float | Unset): Experiments already in use
        max_ (float | Unset): What the plan allows
    """

    error: str
    message: str | Unset = UNSET
    fault: str | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    limit_type: str | Unset = UNSET
    current: float | Unset = UNSET
    max_: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        fault = self.fault

        tips: list[str] | Unset = UNSET
        if not isinstance(self.tips, Unset):
            tips = self.tips

        docs_url = self.docs_url

        limit_type = self.limit_type

        current = self.current

        max_ = self.max_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message
        if fault is not UNSET:
            field_dict["fault"] = fault
        if tips is not UNSET:
            field_dict["tips"] = tips
        if docs_url is not UNSET:
            field_dict["docsUrl"] = docs_url
        if limit_type is not UNSET:
            field_dict["limitType"] = limit_type
        if current is not UNSET:
            field_dict["current"] = current
        if max_ is not UNSET:
            field_dict["max"] = max_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        message = d.pop("message", UNSET)

        fault = d.pop("fault", UNSET)

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docsUrl", UNSET)

        limit_type = d.pop("limitType", UNSET)

        current = d.pop("current", UNSET)

        max_ = d.pop("max", UNSET)

        post_api_experiment_init_response_403 = cls(
            error=error,
            message=message,
            fault=fault,
            tips=tips,
            docs_url=docs_url,
            limit_type=limit_type,
            current=current,
            max_=max_,
        )

        post_api_experiment_init_response_403.additional_properties = d
        return post_api_experiment_init_response_403

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
