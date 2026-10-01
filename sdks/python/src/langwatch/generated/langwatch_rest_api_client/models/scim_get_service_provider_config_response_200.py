from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.scim_get_service_provider_config_response_200_authentication_schemes_item import (
        ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem,
    )
    from ..models.scim_get_service_provider_config_response_200_bulk import ScimGetServiceProviderConfigResponse200Bulk
    from ..models.scim_get_service_provider_config_response_200_change_password import (
        ScimGetServiceProviderConfigResponse200ChangePassword,
    )
    from ..models.scim_get_service_provider_config_response_200_etag import ScimGetServiceProviderConfigResponse200Etag
    from ..models.scim_get_service_provider_config_response_200_filter import (
        ScimGetServiceProviderConfigResponse200Filter,
    )
    from ..models.scim_get_service_provider_config_response_200_patch import (
        ScimGetServiceProviderConfigResponse200Patch,
    )
    from ..models.scim_get_service_provider_config_response_200_sort import ScimGetServiceProviderConfigResponse200Sort


T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200")


@_attrs_define
class ScimGetServiceProviderConfigResponse200:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig']]):
        documentation_uri (str):
        patch (ScimGetServiceProviderConfigResponse200Patch):
        bulk (ScimGetServiceProviderConfigResponse200Bulk):
        filter_ (ScimGetServiceProviderConfigResponse200Filter):
        change_password (ScimGetServiceProviderConfigResponse200ChangePassword):
        sort (ScimGetServiceProviderConfigResponse200Sort):
        etag (ScimGetServiceProviderConfigResponse200Etag):
        authentication_schemes (list[ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem]):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"]]
    documentation_uri: str
    patch: ScimGetServiceProviderConfigResponse200Patch
    bulk: ScimGetServiceProviderConfigResponse200Bulk
    filter_: ScimGetServiceProviderConfigResponse200Filter
    change_password: ScimGetServiceProviderConfigResponse200ChangePassword
    sort: ScimGetServiceProviderConfigResponse200Sort
    etag: ScimGetServiceProviderConfigResponse200Etag
    authentication_schemes: list[ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem]

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        documentation_uri = self.documentation_uri

        patch = self.patch.to_dict()

        bulk = self.bulk.to_dict()

        filter_ = self.filter_.to_dict()

        change_password = self.change_password.to_dict()

        sort = self.sort.to_dict()

        etag = self.etag.to_dict()

        authentication_schemes = []
        for authentication_schemes_item_data in self.authentication_schemes:
            authentication_schemes_item = authentication_schemes_item_data.to_dict()
            authentication_schemes.append(authentication_schemes_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "documentationUri": documentation_uri,
                "patch": patch,
                "bulk": bulk,
                "filter": filter_,
                "changePassword": change_password,
                "sort": sort,
                "etag": etag,
                "authenticationSchemes": authentication_schemes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_get_service_provider_config_response_200_authentication_schemes_item import (
            ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem,
        )
        from ..models.scim_get_service_provider_config_response_200_bulk import (
            ScimGetServiceProviderConfigResponse200Bulk,
        )
        from ..models.scim_get_service_provider_config_response_200_change_password import (
            ScimGetServiceProviderConfigResponse200ChangePassword,
        )
        from ..models.scim_get_service_provider_config_response_200_etag import (
            ScimGetServiceProviderConfigResponse200Etag,
        )
        from ..models.scim_get_service_provider_config_response_200_filter import (
            ScimGetServiceProviderConfigResponse200Filter,
        )
        from ..models.scim_get_service_provider_config_response_200_patch import (
            ScimGetServiceProviderConfigResponse200Patch,
        )
        from ..models.scim_get_service_provider_config_response_200_sort import (
            ScimGetServiceProviderConfigResponse200Sort,
        )

        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(
                Literal["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], schemas_item_data
            )
            if schemas_item != "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        documentation_uri = d.pop("documentationUri")

        patch = ScimGetServiceProviderConfigResponse200Patch.from_dict(d.pop("patch"))

        bulk = ScimGetServiceProviderConfigResponse200Bulk.from_dict(d.pop("bulk"))

        filter_ = ScimGetServiceProviderConfigResponse200Filter.from_dict(d.pop("filter"))

        change_password = ScimGetServiceProviderConfigResponse200ChangePassword.from_dict(d.pop("changePassword"))

        sort = ScimGetServiceProviderConfigResponse200Sort.from_dict(d.pop("sort"))

        etag = ScimGetServiceProviderConfigResponse200Etag.from_dict(d.pop("etag"))

        authentication_schemes = []
        _authentication_schemes = d.pop("authenticationSchemes")
        for authentication_schemes_item_data in _authentication_schemes:
            authentication_schemes_item = ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem.from_dict(
                authentication_schemes_item_data
            )

            authentication_schemes.append(authentication_schemes_item)

        scim_get_service_provider_config_response_200 = cls(
            schemas=schemas,
            documentation_uri=documentation_uri,
            patch=patch,
            bulk=bulk,
            filter_=filter_,
            change_password=change_password,
            sort=sort,
            etag=etag,
            authentication_schemes=authentication_schemes,
        )

        return scim_get_service_provider_config_response_200
