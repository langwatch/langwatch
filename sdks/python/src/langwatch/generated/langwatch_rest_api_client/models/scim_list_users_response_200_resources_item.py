from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_list_users_response_200_resources_item_emails_item import (
        ScimListUsersResponse200ResourcesItemEmailsItem,
    )
    from ..models.scim_list_users_response_200_resources_item_meta import ScimListUsersResponse200ResourcesItemMeta
    from ..models.scim_list_users_response_200_resources_item_name import ScimListUsersResponse200ResourcesItemName


T = TypeVar("T", bound="ScimListUsersResponse200ResourcesItem")


@_attrs_define
class ScimListUsersResponse200ResourcesItem:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:User']]):
        id (str):
        user_name (str):
        name (ScimListUsersResponse200ResourcesItemName):
        emails (list[ScimListUsersResponse200ResourcesItemEmailsItem]):
        active (bool):
        meta (ScimListUsersResponse200ResourcesItemMeta):
        external_id (str | Unset):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:User"]]
    id: str
    user_name: str
    name: ScimListUsersResponse200ResourcesItemName
    emails: list[ScimListUsersResponse200ResourcesItemEmailsItem]
    active: bool
    meta: ScimListUsersResponse200ResourcesItemMeta
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
        from ..models.scim_list_users_response_200_resources_item_emails_item import (
            ScimListUsersResponse200ResourcesItemEmailsItem,
        )
        from ..models.scim_list_users_response_200_resources_item_meta import ScimListUsersResponse200ResourcesItemMeta
        from ..models.scim_list_users_response_200_resources_item_name import ScimListUsersResponse200ResourcesItemName

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

        name = ScimListUsersResponse200ResourcesItemName.from_dict(d.pop("name"))

        emails = []
        _emails = d.pop("emails")
        for emails_item_data in _emails:
            emails_item = ScimListUsersResponse200ResourcesItemEmailsItem.from_dict(emails_item_data)

            emails.append(emails_item)

        active = d.pop("active")

        meta = ScimListUsersResponse200ResourcesItemMeta.from_dict(d.pop("meta"))

        external_id = d.pop("externalId", UNSET)

        scim_list_users_response_200_resources_item = cls(
            schemas=schemas,
            id=id,
            user_name=user_name,
            name=name,
            emails=emails,
            active=active,
            meta=meta,
            external_id=external_id,
        )

        return scim_list_users_response_200_resources_item
