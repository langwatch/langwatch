from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ProvisionOrganizationResponse201AdminApiKey")


@_attrs_define
class ProvisionOrganizationResponse201AdminApiKey:
    """
    Attributes:
        id (str):
        token (str):
    """

    id: str
    token: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        token = self.token

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "token": token,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        token = d.pop("token")

        provision_organization_response_201_admin_api_key = cls(
            id=id,
            token=token,
        )

        return provision_organization_response_201_admin_api_key
