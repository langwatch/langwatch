from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_get_user_response_200_emails_item import ScimGetUserResponse200EmailsItem
    from ..models.scim_get_user_response_200_meta import ScimGetUserResponse200Meta
    from ..models.scim_get_user_response_200_name import ScimGetUserResponse200Name


T = TypeVar("T", bound="ScimGetUserResponse200")


@_attrs_define
class ScimGetUserResponse200:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:User']]):
        id (str):
        user_name (str):
        name (ScimGetUserResponse200Name):
        emails (list[ScimGetUserResponse200EmailsItem]):
        active (bool):
        meta (ScimGetUserResponse200Meta):
        external_id (str | Unset):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:User"]]
    id: str
    user_name: str
    name: ScimGetUserResponse200Name
    emails: list[ScimGetUserResponse200EmailsItem]
    active: bool
    meta: ScimGetUserResponse200Meta
    external_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        id = self.id

        user_name = self.user_name

        name = self.name.to_dict()

        emails = []
        for emails_item_data in self.emails:
            emails_item = emails_item_data.to_dict()
            emails.append(emails_item)

        active = self.active

        meta = self.meta.to_dict()

        external_id = self.external_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "id": id,
                "userName": user_name,
                "name": name,
                "emails": emails,
                "active": active,
                "meta": meta,
            }
        )
        if external_id is not UNSET:
            field_dict["externalId"] = external_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_get_user_response_200_emails_item import ScimGetUserResponse200EmailsItem
        from ..models.scim_get_user_response_200_meta import ScimGetUserResponse200Meta
        from ..models.scim_get_user_response_200_name import ScimGetUserResponse200Name

        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:schemas:core:2.0:User"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:schemas:core:2.0:User":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:schemas:core:2.0:User', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        id = d.pop("id")

        user_name = d.pop("userName")

        name = ScimGetUserResponse200Name.from_dict(d.pop("name"))

        emails = []
        _emails = d.pop("emails")
        for emails_item_data in _emails:
            emails_item = ScimGetUserResponse200EmailsItem.from_dict(emails_item_data)

            emails.append(emails_item)

        active = d.pop("active")

        meta = ScimGetUserResponse200Meta.from_dict(d.pop("meta"))

        external_id = d.pop("externalId", UNSET)

        scim_get_user_response_200 = cls(
            schemas=schemas,
            id=id,
            user_name=user_name,
            name=name,
            emails=emails,
            active=active,
            meta=meta,
            external_id=external_id,
        )

        return scim_get_user_response_200
