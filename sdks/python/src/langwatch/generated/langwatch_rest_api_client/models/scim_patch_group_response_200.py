from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_patch_group_response_200_members_item import ScimPatchGroupResponse200MembersItem
    from ..models.scim_patch_group_response_200_meta import ScimPatchGroupResponse200Meta


T = TypeVar("T", bound="ScimPatchGroupResponse200")


@_attrs_define
class ScimPatchGroupResponse200:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:Group']]):
        id (str):
        display_name (str):
        meta (ScimPatchGroupResponse200Meta):
        external_id (str | Unset):
        members (list[ScimPatchGroupResponse200MembersItem] | Unset):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:Group"]]
    id: str
    display_name: str
    meta: ScimPatchGroupResponse200Meta
    external_id: str | Unset = UNSET
    members: list[ScimPatchGroupResponse200MembersItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        id = self.id

        display_name = self.display_name

        meta = self.meta.to_dict()

        external_id = self.external_id

        members: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.members, Unset):
            members = []
            for members_item_data in self.members:
                members_item = members_item_data.to_dict()
                members.append(members_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "id": id,
                "displayName": display_name,
                "meta": meta,
            }
        )
        if external_id is not UNSET:
            field_dict["externalId"] = external_id
        if members is not UNSET:
            field_dict["members"] = members

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_patch_group_response_200_members_item import ScimPatchGroupResponse200MembersItem
        from ..models.scim_patch_group_response_200_meta import ScimPatchGroupResponse200Meta

        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:schemas:core:2.0:Group"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:schemas:core:2.0:Group":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:schemas:core:2.0:Group', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        id = d.pop("id")

        display_name = d.pop("displayName")

        meta = ScimPatchGroupResponse200Meta.from_dict(d.pop("meta"))

        external_id = d.pop("externalId", UNSET)

        _members = d.pop("members", UNSET)
        members: list[ScimPatchGroupResponse200MembersItem] | Unset = UNSET
        if _members is not UNSET:
            members = []
            for members_item_data in _members:
                members_item = ScimPatchGroupResponse200MembersItem.from_dict(members_item_data)

                members.append(members_item)

        scim_patch_group_response_200 = cls(
            schemas=schemas,
            id=id,
            display_name=display_name,
            meta=meta,
            external_id=external_id,
            members=members,
        )

        return scim_patch_group_response_200
