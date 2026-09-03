from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiExperimentsBySlugWorkbenchStateResponse401")


@_attrs_define
class GetApiExperimentsBySlugWorkbenchStateResponse401:
    """
    Attributes:
        error (str): Stable failure code; branch on this
        message (str | Unset):
        fault (str | Unset): Who the failure is attributable to: customer, platform, provider
        tips (list[str] | Unset):
        docs_url (str | Unset):
    """

    error: str
    message: str | Unset = UNSET
    fault: str | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        fault = self.fault

        tips: list[str] | Unset = UNSET
        if not isinstance(self.tips, Unset):
            tips = self.tips

        docs_url = self.docs_url

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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        message = d.pop("message", UNSET)

        fault = d.pop("fault", UNSET)

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docsUrl", UNSET)

        get_api_experiments_by_slug_workbench_state_response_401 = cls(
            error=error,
            message=message,
            fault=fault,
            tips=tips,
            docs_url=docs_url,
        )

        get_api_experiments_by_slug_workbench_state_response_401.additional_properties = d
        return get_api_experiments_by_slug_workbench_state_response_401

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
