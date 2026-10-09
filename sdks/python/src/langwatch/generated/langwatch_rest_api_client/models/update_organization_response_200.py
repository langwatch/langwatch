from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_organization_response_200_primary_intent_type_1 import (
    UpdateOrganizationResponse200PrimaryIntentType1,
)
from ..models.update_organization_response_200_primary_intent_type_2_type_1 import (
    UpdateOrganizationResponse200PrimaryIntentType2Type1,
)
from ..models.update_organization_response_200_primary_intent_type_3_type_1 import (
    UpdateOrganizationResponse200PrimaryIntentType3Type1,
)

T = TypeVar("T", bound="UpdateOrganizationResponse200")


@_attrs_define
class UpdateOrganizationResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        support_contact (None | str):
        presence_enabled (bool):
        trace_sharing_enabled (bool):
        primary_intent (None | UpdateOrganizationResponse200PrimaryIntentType1 |
            UpdateOrganizationResponse200PrimaryIntentType2Type1 | UpdateOrganizationResponse200PrimaryIntentType3Type1):
        s_3_endpoint (None | str):
        s_3_access_key_id (None | str):
        s_3_bucket (None | str):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    slug: str
    support_contact: None | str
    presence_enabled: bool
    trace_sharing_enabled: bool
    primary_intent: (
        None
        | UpdateOrganizationResponse200PrimaryIntentType1
        | UpdateOrganizationResponse200PrimaryIntentType2Type1
        | UpdateOrganizationResponse200PrimaryIntentType3Type1
    )
    s_3_endpoint: None | str
    s_3_access_key_id: None | str
    s_3_bucket: None | str
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        support_contact: None | str
        support_contact = self.support_contact

        presence_enabled = self.presence_enabled

        trace_sharing_enabled = self.trace_sharing_enabled

        primary_intent: None | str
        if isinstance(self.primary_intent, UpdateOrganizationResponse200PrimaryIntentType1):
            primary_intent = self.primary_intent.value
        elif isinstance(self.primary_intent, UpdateOrganizationResponse200PrimaryIntentType2Type1):
            primary_intent = self.primary_intent.value
        elif isinstance(self.primary_intent, UpdateOrganizationResponse200PrimaryIntentType3Type1):
            primary_intent = self.primary_intent.value
        else:
            primary_intent = self.primary_intent

        s_3_endpoint: None | str
        s_3_endpoint = self.s_3_endpoint

        s_3_access_key_id: None | str
        s_3_access_key_id = self.s_3_access_key_id

        s_3_bucket: None | str
        s_3_bucket = self.s_3_bucket

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "supportContact": support_contact,
                "presenceEnabled": presence_enabled,
                "traceSharingEnabled": trace_sharing_enabled,
                "primaryIntent": primary_intent,
                "s3Endpoint": s_3_endpoint,
                "s3AccessKeyId": s_3_access_key_id,
                "s3Bucket": s_3_bucket,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_support_contact(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        support_contact = _parse_support_contact(d.pop("supportContact"))

        presence_enabled = d.pop("presenceEnabled")

        trace_sharing_enabled = d.pop("traceSharingEnabled")

        def _parse_primary_intent(
            data: object,
        ) -> (
            None
            | UpdateOrganizationResponse200PrimaryIntentType1
            | UpdateOrganizationResponse200PrimaryIntentType2Type1
            | UpdateOrganizationResponse200PrimaryIntentType3Type1
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_1 = UpdateOrganizationResponse200PrimaryIntentType1(data)

                return primary_intent_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_2_type_1 = UpdateOrganizationResponse200PrimaryIntentType2Type1(data)

                return primary_intent_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_3_type_1 = UpdateOrganizationResponse200PrimaryIntentType3Type1(data)

                return primary_intent_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | UpdateOrganizationResponse200PrimaryIntentType1
                | UpdateOrganizationResponse200PrimaryIntentType2Type1
                | UpdateOrganizationResponse200PrimaryIntentType3Type1,
                data,
            )

        primary_intent = _parse_primary_intent(d.pop("primaryIntent"))

        def _parse_s_3_endpoint(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        s_3_endpoint = _parse_s_3_endpoint(d.pop("s3Endpoint"))

        def _parse_s_3_access_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        s_3_access_key_id = _parse_s_3_access_key_id(d.pop("s3AccessKeyId"))

        def _parse_s_3_bucket(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        s_3_bucket = _parse_s_3_bucket(d.pop("s3Bucket"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        update_organization_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            support_contact=support_contact,
            presence_enabled=presence_enabled,
            trace_sharing_enabled=trace_sharing_enabled,
            primary_intent=primary_intent,
            s_3_endpoint=s_3_endpoint,
            s_3_access_key_id=s_3_access_key_id,
            s_3_bucket=s_3_bucket,
            created_at=created_at,
            updated_at=updated_at,
        )

        update_organization_response_200.additional_properties = d
        return update_organization_response_200

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
