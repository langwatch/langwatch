from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_replace_user_response_200_emails_item import ScimReplaceUserResponse200EmailsItem
    from ..models.scim_replace_user_response_200_meta import ScimReplaceUserResponse200Meta
    from ..models.scim_replace_user_response_200_name import ScimReplaceUserResponse200Name


T = TypeVar("T", bound="ScimReplaceUserResponse200")


@_attrs_define
class ScimReplaceUserResponse200:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        id (str | Unset): The LangWatch user id. Use it as the resource id in later calls, and as a member value on a
            group.
        user_name (str | Unset): The member's email address, which is their login.
        name (ScimReplaceUserResponse200Name | Unset):
        emails (list[ScimReplaceUserResponse200EmailsItem] | Unset):
        active (bool | Unset): False once the account is deactivated.
        meta (ScimReplaceUserResponse200Meta | Unset):
    """

    schemas: list[str] | Unset = UNSET
    id: str | Unset = UNSET
    user_name: str | Unset = UNSET
    name: ScimReplaceUserResponse200Name | Unset = UNSET
    emails: list[ScimReplaceUserResponse200EmailsItem] | Unset = UNSET
    active: bool | Unset = UNSET
    meta: ScimReplaceUserResponse200Meta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        id = self.id

        user_name = self.user_name

        name: dict[str, Any] | Unset = UNSET
        if not isinstance(self.name, Unset):
            name = self.name.to_dict()

        emails: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.emails, Unset):
            emails = []
            for emails_item_data in self.emails:
                emails_item = emails_item_data.to_dict()
                emails.append(emails_item)

        active = self.active

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if id is not UNSET:
            field_dict["id"] = id
        if user_name is not UNSET:
            field_dict["userName"] = user_name
        if name is not UNSET:
            field_dict["name"] = name
        if emails is not UNSET:
            field_dict["emails"] = emails
        if active is not UNSET:
            field_dict["active"] = active
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_replace_user_response_200_emails_item import ScimReplaceUserResponse200EmailsItem
        from ..models.scim_replace_user_response_200_meta import ScimReplaceUserResponse200Meta
        from ..models.scim_replace_user_response_200_name import ScimReplaceUserResponse200Name

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        id = d.pop("id", UNSET)

        user_name = d.pop("userName", UNSET)

        _name = d.pop("name", UNSET)
        name: ScimReplaceUserResponse200Name | Unset
        if isinstance(_name, Unset):
            name = UNSET
        else:
            name = ScimReplaceUserResponse200Name.from_dict(_name)

        _emails = d.pop("emails", UNSET)
        emails: list[ScimReplaceUserResponse200EmailsItem] | Unset = UNSET
        if _emails is not UNSET:
            emails = []
            for emails_item_data in _emails:
                emails_item = ScimReplaceUserResponse200EmailsItem.from_dict(emails_item_data)

                emails.append(emails_item)

        active = d.pop("active", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: ScimReplaceUserResponse200Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ScimReplaceUserResponse200Meta.from_dict(_meta)

        scim_replace_user_response_200 = cls(
            schemas=schemas,
            id=id,
            user_name=user_name,
            name=name,
            emails=emails,
            active=active,
            meta=meta,
        )

        scim_replace_user_response_200.additional_properties = d
        return scim_replace_user_response_200

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
