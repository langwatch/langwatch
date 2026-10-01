from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimGetGroupResponse200Meta")


@_attrs_define
class ScimGetGroupResponse200Meta:
    """
    Attributes:
        resource_type (Literal['Group']):
        created (str):
        last_modified (str):
    """

    resource_type: Literal["Group"]
    created: str
    last_modified: str

    def to_dict(self) -> dict[str, Any]:
        resource_type = self.resource_type

        created = self.created

        last_modified = self.last_modified

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "resourceType": resource_type,
                "created": created,
                "lastModified": last_modified,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resource_type = cast(Literal["Group"], d.pop("resourceType"))
        if resource_type != "Group":
            raise ValueError(f"resourceType must match const 'Group', got '{resource_type}'")

        created = d.pop("created")

        last_modified = d.pop("lastModified")

        scim_get_group_response_200_meta = cls(
            resource_type=resource_type,
            created=created,
            last_modified=last_modified,
        )

        return scim_get_group_response_200_meta
