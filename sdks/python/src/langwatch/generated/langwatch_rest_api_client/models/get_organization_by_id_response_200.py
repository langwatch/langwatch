from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_organization_by_id_response_200_organization import GetOrganizationByIdResponse200Organization


T = TypeVar("T", bound="GetOrganizationByIdResponse200")


@_attrs_define
class GetOrganizationByIdResponse200:
    """
    Attributes:
        organization (GetOrganizationByIdResponse200Organization):
    """

    organization: GetOrganizationByIdResponse200Organization

    def to_dict(self) -> dict[str, Any]:
        organization = self.organization.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization": organization,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_organization_by_id_response_200_organization import GetOrganizationByIdResponse200Organization

        d = dict(src_dict)
        organization = GetOrganizationByIdResponse200Organization.from_dict(d.pop("organization"))

        get_organization_by_id_response_200 = cls(
            organization=organization,
        )

        return get_organization_by_id_response_200
