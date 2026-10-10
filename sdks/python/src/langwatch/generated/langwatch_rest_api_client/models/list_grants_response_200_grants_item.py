from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.list_grants_response_200_grants_item_status import ListGrantsResponse200GrantsItemStatus

if TYPE_CHECKING:
    from ..models.list_grants_response_200_grants_item_principal import ListGrantsResponse200GrantsItemPrincipal
    from ..models.list_grants_response_200_grants_item_role import ListGrantsResponse200GrantsItemRole
    from ..models.list_grants_response_200_grants_item_scope import ListGrantsResponse200GrantsItemScope


T = TypeVar("T", bound="ListGrantsResponse200GrantsItem")


@_attrs_define
class ListGrantsResponse200GrantsItem:
    """
    Attributes:
        id (str):
        principal (ListGrantsResponse200GrantsItemPrincipal):
        role (ListGrantsResponse200GrantsItemRole):
        scope (ListGrantsResponse200GrantsItemScope):
        status (ListGrantsResponse200GrantsItemStatus):
        expires_at (datetime.datetime | None):
        created_at (datetime.datetime):
    """

    id: str
    principal: ListGrantsResponse200GrantsItemPrincipal
    role: ListGrantsResponse200GrantsItemRole
    scope: ListGrantsResponse200GrantsItemScope
    status: ListGrantsResponse200GrantsItemStatus
    expires_at: datetime.datetime | None
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        principal = self.principal.to_dict()

        role = self.role.to_dict()

        scope = self.scope.to_dict()

        status = self.status.value

        expires_at: None | str
        if isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "principal": principal,
                "role": role,
                "scope": scope,
                "status": status,
                "expiresAt": expires_at,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_grants_response_200_grants_item_principal import ListGrantsResponse200GrantsItemPrincipal
        from ..models.list_grants_response_200_grants_item_role import ListGrantsResponse200GrantsItemRole
        from ..models.list_grants_response_200_grants_item_scope import ListGrantsResponse200GrantsItemScope

        d = dict(src_dict)
        id = d.pop("id")

        principal = ListGrantsResponse200GrantsItemPrincipal.from_dict(d.pop("principal"))

        role = ListGrantsResponse200GrantsItemRole.from_dict(d.pop("role"))

        scope = ListGrantsResponse200GrantsItemScope.from_dict(d.pop("scope"))

        status = ListGrantsResponse200GrantsItemStatus(d.pop("status"))

        def _parse_expires_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                expires_at_type_0 = isoparse(data)

                return expires_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        expires_at = _parse_expires_at(d.pop("expiresAt"))

        created_at = isoparse(d.pop("createdAt"))

        list_grants_response_200_grants_item = cls(
            id=id,
            principal=principal,
            role=role,
            scope=scope,
            status=status,
            expires_at=expires_at,
            created_at=created_at,
        )

        return list_grants_response_200_grants_item
