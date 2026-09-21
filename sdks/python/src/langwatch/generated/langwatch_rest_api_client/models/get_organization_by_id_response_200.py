from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_organization_by_id_response_200_organization import GetOrganizationByIdResponse200Organization


T = TypeVar("T", bound="GetOrganizationByIdResponse200")


@_attrs_define
class GetOrganizationByIdResponse200:
    """
    Attributes:
        organization (GetOrganizationByIdResponse200Organization | Unset):
    """

    organization: GetOrganizationByIdResponse200Organization | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        organization: dict[str, Any] | Unset = UNSET
        if not isinstance(self.organization, Unset):
            organization = self.organization.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if organization is not UNSET:
            field_dict["organization"] = organization

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_organization_by_id_response_200_organization import GetOrganizationByIdResponse200Organization

        d = dict(src_dict)
        _organization = d.pop("organization", UNSET)
        organization: GetOrganizationByIdResponse200Organization | Unset
        if isinstance(_organization, Unset):
            organization = UNSET
        else:
            organization = GetOrganizationByIdResponse200Organization.from_dict(_organization)

        get_organization_by_id_response_200 = cls(
            organization=organization,
        )

        get_organization_by_id_response_200.additional_properties = d
        return get_organization_by_id_response_200

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
