from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_purpose import (
    PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyPurpose,
)
from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_routing_mode import (
    PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyRoutingMode,
)
from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_status import (
    PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyStatus,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_metadata import (
        PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyMetadata,
    )
    from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_scopes_item import (
        PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItem,
    )


T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKey")


@_attrs_define
class PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKey:
    """
    Attributes:
        id (str):
        organization_id (str):
        name (str):
        description (None | str):
        status (PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyStatus):
        purpose (PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyPurpose):
        display_prefix (str):
        principal_user_id (None | str):
        trace_project_id (None | str):
        external_id (None | str):
        metadata (PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyMetadata):
        scopes (list[PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItem]):
        routing_policy_id (None | str):
        routing_mode (PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyRoutingMode):
        revision (str):
        created_at (str):
        updated_at (str):
        last_used_at (None | str):
        revoked_at (None | str):
        config (Any | Unset):
    """

    id: str
    organization_id: str
    name: str
    description: None | str
    status: PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyStatus
    purpose: PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyPurpose
    display_prefix: str
    principal_user_id: None | str
    trace_project_id: None | str
    external_id: None | str
    metadata: PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyMetadata
    scopes: list[PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItem]
    routing_policy_id: None | str
    routing_mode: PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyRoutingMode
    revision: str
    created_at: str
    updated_at: str
    last_used_at: None | str
    revoked_at: None | str
    config: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        organization_id = self.organization_id

        name = self.name

        description: None | str
        description = self.description

        status = self.status.value

        purpose = self.purpose.value

        display_prefix = self.display_prefix

        principal_user_id: None | str
        principal_user_id = self.principal_user_id

        trace_project_id: None | str
        trace_project_id = self.trace_project_id

        external_id: None | str
        external_id = self.external_id

        metadata = self.metadata.to_dict()

        scopes = []
        for scopes_item_data in self.scopes:
            scopes_item = scopes_item_data.to_dict()
            scopes.append(scopes_item)

        routing_policy_id: None | str
        routing_policy_id = self.routing_policy_id

        routing_mode = self.routing_mode.value

        revision = self.revision

        created_at = self.created_at

        updated_at = self.updated_at

        last_used_at: None | str
        last_used_at = self.last_used_at

        revoked_at: None | str
        revoked_at = self.revoked_at

        config = self.config

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "name": name,
                "description": description,
                "status": status,
                "purpose": purpose,
                "display_prefix": display_prefix,
                "principal_user_id": principal_user_id,
                "trace_project_id": trace_project_id,
                "external_id": external_id,
                "metadata": metadata,
                "scopes": scopes,
                "routing_policy_id": routing_policy_id,
                "routing_mode": routing_mode,
                "revision": revision,
                "created_at": created_at,
                "updated_at": updated_at,
                "last_used_at": last_used_at,
                "revoked_at": revoked_at,
            }
        )
        if config is not UNSET:
            field_dict["config"] = config

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_metadata import (
            PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyMetadata,
        )
        from ..models.post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key_scopes_item import (
            PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        organization_id = d.pop("organization_id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        status = PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyStatus(d.pop("status"))

        purpose = PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyPurpose(d.pop("purpose"))

        display_prefix = d.pop("display_prefix")

        def _parse_principal_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        principal_user_id = _parse_principal_user_id(d.pop("principal_user_id"))

        def _parse_trace_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        trace_project_id = _parse_trace_project_id(d.pop("trace_project_id"))

        def _parse_external_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_id = _parse_external_id(d.pop("external_id"))

        metadata = PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyMetadata.from_dict(d.pop("metadata"))

        scopes = []
        _scopes = d.pop("scopes")
        for scopes_item_data in _scopes:
            scopes_item = PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItem.from_dict(
                scopes_item_data
            )

            scopes.append(scopes_item)

        def _parse_routing_policy_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        routing_policy_id = _parse_routing_policy_id(d.pop("routing_policy_id"))

        routing_mode = PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyRoutingMode(d.pop("routing_mode"))

        revision = d.pop("revision")

        created_at = d.pop("created_at")

        updated_at = d.pop("updated_at")

        def _parse_last_used_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_used_at = _parse_last_used_at(d.pop("last_used_at"))

        def _parse_revoked_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        revoked_at = _parse_revoked_at(d.pop("revoked_at"))

        config = d.pop("config", UNSET)

        post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key = cls(
            id=id,
            organization_id=organization_id,
            name=name,
            description=description,
            status=status,
            purpose=purpose,
            display_prefix=display_prefix,
            principal_user_id=principal_user_id,
            trace_project_id=trace_project_id,
            external_id=external_id,
            metadata=metadata,
            scopes=scopes,
            routing_policy_id=routing_policy_id,
            routing_mode=routing_mode,
            revision=revision,
            created_at=created_at,
            updated_at=updated_at,
            last_used_at=last_used_at,
            revoked_at=revoked_at,
            config=config,
        )

        post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key.additional_properties = d
        return post_api_gateway_v1_virtual_keys_by_id_enable_response_200_virtual_key

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
