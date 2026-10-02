from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimPatchGroupResponse404")


@_attrs_define
class ScimPatchGroupResponse404:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:api:messages:2.0:Error']]):
        status (str):
        detail (str):
        scim_type (str | Unset):
    """

    schemas: list[Literal["urn:ietf:params:scim:api:messages:2.0:Error"]]
    status: str
    detail: str
    scim_type: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        status = self.status

        detail = self.detail

        scim_type = self.scim_type

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "status": status,
                "detail": detail,
            }
        )
        if scim_type is not UNSET:
            field_dict["scimType"] = scim_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:api:messages:2.0:Error"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:api:messages:2.0:Error":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:api:messages:2.0:Error', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        status = d.pop("status")

        detail = d.pop("detail")

        scim_type = d.pop("scimType", UNSET)

        scim_patch_group_response_404 = cls(
            schemas=schemas,
            status=status,
            detail=detail,
            scim_type=scim_type,
        )

        return scim_patch_group_response_404
