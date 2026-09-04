from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimReplaceUserResponse401")


@_attrs_define
class ScimReplaceUserResponse401:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        status (str | Unset): The HTTP status, as a string.
        detail (str | Unset):
    """

    schemas: list[str] | Unset = UNSET
    status: str | Unset = UNSET
    detail: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        status = self.status

        detail = self.detail

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if status is not UNSET:
            field_dict["status"] = status
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        status = d.pop("status", UNSET)

        detail = d.pop("detail", UNSET)

        scim_replace_user_response_401 = cls(
            schemas=schemas,
            status=status,
            detail=detail,
        )

        scim_replace_user_response_401.additional_properties = d
        return scim_replace_user_response_401

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
