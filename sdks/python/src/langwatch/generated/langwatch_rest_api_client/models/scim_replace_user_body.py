from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_replace_user_body_emails_item import ScimReplaceUserBodyEmailsItem
    from ..models.scim_replace_user_body_name import ScimReplaceUserBodyName
    from ..models.scim_replace_user_body_urnietfparamsscimschemasextensionenterprise_20_user import (
        ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User,
    )


T = TypeVar("T", bound="ScimReplaceUserBody")


@_attrs_define
class ScimReplaceUserBody:
    """
    Attributes:
        schemas (list[str]):
        user_name (str):
        external_id (str | Unset):
        name (ScimReplaceUserBodyName | Unset):
        emails (list[ScimReplaceUserBodyEmailsItem] | Unset):
        active (bool | Unset):
        urnietfparamsscimschemasextensionenterprise_2_0_user
            (ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User | Unset):
    """

    schemas: list[str]
    user_name: str
    external_id: str | Unset = UNSET
    name: ScimReplaceUserBodyName | Unset = UNSET
    emails: list[ScimReplaceUserBodyEmailsItem] | Unset = UNSET
    active: bool | Unset = UNSET
    urnietfparamsscimschemasextensionenterprise_2_0_user: (
        ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        user_name = self.user_name

        external_id = self.external_id

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

        urnietfparamsscimschemasextensionenterprise_2_0_user: dict[str, Any] | Unset = UNSET
        if not isinstance(self.urnietfparamsscimschemasextensionenterprise_2_0_user, Unset):
            urnietfparamsscimschemasextensionenterprise_2_0_user = (
                self.urnietfparamsscimschemasextensionenterprise_2_0_user.to_dict()
            )

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "schemas": schemas,
                "userName": user_name,
            }
        )
        if external_id is not UNSET:
            field_dict["externalId"] = external_id
        if name is not UNSET:
            field_dict["name"] = name
        if emails is not UNSET:
            field_dict["emails"] = emails
        if active is not UNSET:
            field_dict["active"] = active
        if urnietfparamsscimschemasextensionenterprise_2_0_user is not UNSET:
            field_dict["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"] = (
                urnietfparamsscimschemasextensionenterprise_2_0_user
            )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_replace_user_body_emails_item import ScimReplaceUserBodyEmailsItem
        from ..models.scim_replace_user_body_name import ScimReplaceUserBodyName
        from ..models.scim_replace_user_body_urnietfparamsscimschemasextensionenterprise_20_user import (
            ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User,
        )

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas"))

        user_name = d.pop("userName")

        external_id = d.pop("externalId", UNSET)

        _name = d.pop("name", UNSET)
        name: ScimReplaceUserBodyName | Unset
        if isinstance(_name, Unset):
            name = UNSET
        else:
            name = ScimReplaceUserBodyName.from_dict(_name)

        _emails = d.pop("emails", UNSET)
        emails: list[ScimReplaceUserBodyEmailsItem] | Unset = UNSET
        if _emails is not UNSET:
            emails = []
            for emails_item_data in _emails:
                emails_item = ScimReplaceUserBodyEmailsItem.from_dict(emails_item_data)

                emails.append(emails_item)

        active = d.pop("active", UNSET)

        _urnietfparamsscimschemasextensionenterprise_2_0_user = d.pop(
            "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User", UNSET
        )
        urnietfparamsscimschemasextensionenterprise_2_0_user: (
            ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User | Unset
        )
        if isinstance(_urnietfparamsscimschemasextensionenterprise_2_0_user, Unset):
            urnietfparamsscimschemasextensionenterprise_2_0_user = UNSET
        else:
            urnietfparamsscimschemasextensionenterprise_2_0_user = (
                ScimReplaceUserBodyUrnietfparamsscimschemasextensionenterprise20User.from_dict(
                    _urnietfparamsscimschemasextensionenterprise_2_0_user
                )
            )

        scim_replace_user_body = cls(
            schemas=schemas,
            user_name=user_name,
            external_id=external_id,
            name=name,
            emails=emails,
            active=active,
            urnietfparamsscimschemasextensionenterprise_2_0_user=urnietfparamsscimschemasextensionenterprise_2_0_user,
        )

        scim_replace_user_body.additional_properties = d
        return scim_replace_user_body

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
