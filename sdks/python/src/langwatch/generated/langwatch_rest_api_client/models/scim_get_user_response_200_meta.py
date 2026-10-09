from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimGetUserResponse200Meta")


@_attrs_define
class ScimGetUserResponse200Meta:
    """
    Attributes:
        resource_type (str | Unset):
        created (datetime.datetime | Unset):
        last_modified (datetime.datetime | Unset):
    """

    resource_type: str | Unset = UNSET
    created: datetime.datetime | Unset = UNSET
    last_modified: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        resource_type = self.resource_type

        created: str | Unset = UNSET
        if not isinstance(self.created, Unset):
            created = self.created.isoformat()

        last_modified: str | Unset = UNSET
        if not isinstance(self.last_modified, Unset):
            last_modified = self.last_modified.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if resource_type is not UNSET:
            field_dict["resourceType"] = resource_type
        if created is not UNSET:
            field_dict["created"] = created
        if last_modified is not UNSET:
            field_dict["lastModified"] = last_modified

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resource_type = d.pop("resourceType", UNSET)

        _created = d.pop("created", UNSET)
        created: datetime.datetime | Unset
        if isinstance(_created, Unset):
            created = UNSET
        else:
            created = isoparse(_created)

        _last_modified = d.pop("lastModified", UNSET)
        last_modified: datetime.datetime | Unset
        if isinstance(_last_modified, Unset):
            last_modified = UNSET
        else:
            last_modified = isoparse(_last_modified)

        scim_get_user_response_200_meta = cls(
            resource_type=resource_type,
            created=created,
            last_modified=last_modified,
        )

        scim_get_user_response_200_meta.additional_properties = d
        return scim_get_user_response_200_meta

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
