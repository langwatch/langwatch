from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

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
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        documentation_uri (str | Unset):
        patch (ScimGetServiceProviderConfigResponse200Patch | Unset):
        bulk (ScimGetServiceProviderConfigResponse200Bulk | Unset):
        filter_ (ScimGetServiceProviderConfigResponse200Filter | Unset):
        change_password (ScimGetServiceProviderConfigResponse200ChangePassword | Unset):
        sort (ScimGetServiceProviderConfigResponse200Sort | Unset):
        etag (ScimGetServiceProviderConfigResponse200Etag | Unset):
        authentication_schemes (list[ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem] | Unset):
    """

    schemas: list[str] | Unset = UNSET
    documentation_uri: str | Unset = UNSET
    patch: ScimGetServiceProviderConfigResponse200Patch | Unset = UNSET
    bulk: ScimGetServiceProviderConfigResponse200Bulk | Unset = UNSET
    filter_: ScimGetServiceProviderConfigResponse200Filter | Unset = UNSET
    change_password: ScimGetServiceProviderConfigResponse200ChangePassword | Unset = UNSET
    sort: ScimGetServiceProviderConfigResponse200Sort | Unset = UNSET
    etag: ScimGetServiceProviderConfigResponse200Etag | Unset = UNSET
    authentication_schemes: list[ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        documentation_uri = self.documentation_uri

        patch: dict[str, Any] | Unset = UNSET
        if not isinstance(self.patch, Unset):
            patch = self.patch.to_dict()

        bulk: dict[str, Any] | Unset = UNSET
        if not isinstance(self.bulk, Unset):
            bulk = self.bulk.to_dict()

        filter_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filter_, Unset):
            filter_ = self.filter_.to_dict()

        change_password: dict[str, Any] | Unset = UNSET
        if not isinstance(self.change_password, Unset):
            change_password = self.change_password.to_dict()

        sort: dict[str, Any] | Unset = UNSET
        if not isinstance(self.sort, Unset):
            sort = self.sort.to_dict()

        etag: dict[str, Any] | Unset = UNSET
        if not isinstance(self.etag, Unset):
            etag = self.etag.to_dict()

        authentication_schemes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.authentication_schemes, Unset):
            authentication_schemes = []
            for authentication_schemes_item_data in self.authentication_schemes:
                authentication_schemes_item = authentication_schemes_item_data.to_dict()
                authentication_schemes.append(authentication_schemes_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if documentation_uri is not UNSET:
            field_dict["documentationUri"] = documentation_uri
        if patch is not UNSET:
            field_dict["patch"] = patch
        if bulk is not UNSET:
            field_dict["bulk"] = bulk
        if filter_ is not UNSET:
            field_dict["filter"] = filter_
        if change_password is not UNSET:
            field_dict["changePassword"] = change_password
        if sort is not UNSET:
            field_dict["sort"] = sort
        if etag is not UNSET:
            field_dict["etag"] = etag
        if authentication_schemes is not UNSET:
            field_dict["authenticationSchemes"] = authentication_schemes

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
        schemas = cast(list[str], d.pop("schemas", UNSET))

        documentation_uri = d.pop("documentationUri", UNSET)

        _patch = d.pop("patch", UNSET)
        patch: ScimGetServiceProviderConfigResponse200Patch | Unset
        if isinstance(_patch, Unset):
            patch = UNSET
        else:
            patch = ScimGetServiceProviderConfigResponse200Patch.from_dict(_patch)

        _bulk = d.pop("bulk", UNSET)
        bulk: ScimGetServiceProviderConfigResponse200Bulk | Unset
        if isinstance(_bulk, Unset):
            bulk = UNSET
        else:
            bulk = ScimGetServiceProviderConfigResponse200Bulk.from_dict(_bulk)

        _filter_ = d.pop("filter", UNSET)
        filter_: ScimGetServiceProviderConfigResponse200Filter | Unset
        if isinstance(_filter_, Unset):
            filter_ = UNSET
        else:
            filter_ = ScimGetServiceProviderConfigResponse200Filter.from_dict(_filter_)

        _change_password = d.pop("changePassword", UNSET)
        change_password: ScimGetServiceProviderConfigResponse200ChangePassword | Unset
        if isinstance(_change_password, Unset):
            change_password = UNSET
        else:
            change_password = ScimGetServiceProviderConfigResponse200ChangePassword.from_dict(_change_password)

        _sort = d.pop("sort", UNSET)
        sort: ScimGetServiceProviderConfigResponse200Sort | Unset
        if isinstance(_sort, Unset):
            sort = UNSET
        else:
            sort = ScimGetServiceProviderConfigResponse200Sort.from_dict(_sort)

        _etag = d.pop("etag", UNSET)
        etag: ScimGetServiceProviderConfigResponse200Etag | Unset
        if isinstance(_etag, Unset):
            etag = UNSET
        else:
            etag = ScimGetServiceProviderConfigResponse200Etag.from_dict(_etag)

        _authentication_schemes = d.pop("authenticationSchemes", UNSET)
        authentication_schemes: list[ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem] | Unset = UNSET
        if _authentication_schemes is not UNSET:
            authentication_schemes = []
            for authentication_schemes_item_data in _authentication_schemes:
                authentication_schemes_item = (
                    ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem.from_dict(
                        authentication_schemes_item_data
                    )
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

        scim_get_service_provider_config_response_200.additional_properties = d
        return scim_get_service_provider_config_response_200

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
