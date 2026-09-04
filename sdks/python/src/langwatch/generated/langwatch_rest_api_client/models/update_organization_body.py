from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_organization_body_primary_intent_type_1 import UpdateOrganizationBodyPrimaryIntentType1
from ..models.update_organization_body_primary_intent_type_2_type_1 import UpdateOrganizationBodyPrimaryIntentType2Type1
from ..models.update_organization_body_primary_intent_type_3_type_1 import UpdateOrganizationBodyPrimaryIntentType3Type1
from ..types import UNSET, Unset

T = TypeVar("T", bound="UpdateOrganizationBody")


@_attrs_define
class UpdateOrganizationBody:
    """
    Attributes:
        name (str | Unset):
        support_contact (None | str | Unset):
        presence_enabled (bool | Unset):
        trace_sharing_enabled (bool | Unset):
        primary_intent (None | Unset | UpdateOrganizationBodyPrimaryIntentType1 |
            UpdateOrganizationBodyPrimaryIntentType2Type1 | UpdateOrganizationBodyPrimaryIntentType3Type1):
        s_3_endpoint (None | str | Unset):
        s_3_access_key_id (None | str | Unset):
        s_3_secret_access_key (None | str | Unset):
        s_3_bucket (None | str | Unset):
    """

    name: str | Unset = UNSET
    support_contact: None | str | Unset = UNSET
    presence_enabled: bool | Unset = UNSET
    trace_sharing_enabled: bool | Unset = UNSET
    primary_intent: (
        None
        | Unset
        | UpdateOrganizationBodyPrimaryIntentType1
        | UpdateOrganizationBodyPrimaryIntentType2Type1
        | UpdateOrganizationBodyPrimaryIntentType3Type1
    ) = UNSET
    s_3_endpoint: None | str | Unset = UNSET
    s_3_access_key_id: None | str | Unset = UNSET
    s_3_secret_access_key: None | str | Unset = UNSET
    s_3_bucket: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        support_contact: None | str | Unset
        if isinstance(self.support_contact, Unset):
            support_contact = UNSET
        else:
            support_contact = self.support_contact

        presence_enabled = self.presence_enabled

        trace_sharing_enabled = self.trace_sharing_enabled

        primary_intent: None | str | Unset
        if isinstance(self.primary_intent, Unset):
            primary_intent = UNSET
        elif isinstance(self.primary_intent, UpdateOrganizationBodyPrimaryIntentType1):
            primary_intent = self.primary_intent.value
        elif isinstance(self.primary_intent, UpdateOrganizationBodyPrimaryIntentType2Type1):
            primary_intent = self.primary_intent.value
        elif isinstance(self.primary_intent, UpdateOrganizationBodyPrimaryIntentType3Type1):
            primary_intent = self.primary_intent.value
        else:
            primary_intent = self.primary_intent

        s_3_endpoint: None | str | Unset
        if isinstance(self.s_3_endpoint, Unset):
            s_3_endpoint = UNSET
        else:
            s_3_endpoint = self.s_3_endpoint

        s_3_access_key_id: None | str | Unset
        if isinstance(self.s_3_access_key_id, Unset):
            s_3_access_key_id = UNSET
        else:
            s_3_access_key_id = self.s_3_access_key_id

        s_3_secret_access_key: None | str | Unset
        if isinstance(self.s_3_secret_access_key, Unset):
            s_3_secret_access_key = UNSET
        else:
            s_3_secret_access_key = self.s_3_secret_access_key

        s_3_bucket: None | str | Unset
        if isinstance(self.s_3_bucket, Unset):
            s_3_bucket = UNSET
        else:
            s_3_bucket = self.s_3_bucket

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if support_contact is not UNSET:
            field_dict["supportContact"] = support_contact
        if presence_enabled is not UNSET:
            field_dict["presenceEnabled"] = presence_enabled
        if trace_sharing_enabled is not UNSET:
            field_dict["traceSharingEnabled"] = trace_sharing_enabled
        if primary_intent is not UNSET:
            field_dict["primaryIntent"] = primary_intent
        if s_3_endpoint is not UNSET:
            field_dict["s3Endpoint"] = s_3_endpoint
        if s_3_access_key_id is not UNSET:
            field_dict["s3AccessKeyId"] = s_3_access_key_id
        if s_3_secret_access_key is not UNSET:
            field_dict["s3SecretAccessKey"] = s_3_secret_access_key
        if s_3_bucket is not UNSET:
            field_dict["s3Bucket"] = s_3_bucket

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_support_contact(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        support_contact = _parse_support_contact(d.pop("supportContact", UNSET))

        presence_enabled = d.pop("presenceEnabled", UNSET)

        trace_sharing_enabled = d.pop("traceSharingEnabled", UNSET)

        def _parse_primary_intent(
            data: object,
        ) -> (
            None
            | Unset
            | UpdateOrganizationBodyPrimaryIntentType1
            | UpdateOrganizationBodyPrimaryIntentType2Type1
            | UpdateOrganizationBodyPrimaryIntentType3Type1
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_1 = UpdateOrganizationBodyPrimaryIntentType1(data)

                return primary_intent_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_2_type_1 = UpdateOrganizationBodyPrimaryIntentType2Type1(data)

                return primary_intent_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                primary_intent_type_3_type_1 = UpdateOrganizationBodyPrimaryIntentType3Type1(data)

                return primary_intent_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | Unset
                | UpdateOrganizationBodyPrimaryIntentType1
                | UpdateOrganizationBodyPrimaryIntentType2Type1
                | UpdateOrganizationBodyPrimaryIntentType3Type1,
                data,
            )

        primary_intent = _parse_primary_intent(d.pop("primaryIntent", UNSET))

        def _parse_s_3_endpoint(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        s_3_endpoint = _parse_s_3_endpoint(d.pop("s3Endpoint", UNSET))

        def _parse_s_3_access_key_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        s_3_access_key_id = _parse_s_3_access_key_id(d.pop("s3AccessKeyId", UNSET))

        def _parse_s_3_secret_access_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        s_3_secret_access_key = _parse_s_3_secret_access_key(d.pop("s3SecretAccessKey", UNSET))

        def _parse_s_3_bucket(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        s_3_bucket = _parse_s_3_bucket(d.pop("s3Bucket", UNSET))

        update_organization_body = cls(
            name=name,
            support_contact=support_contact,
            presence_enabled=presence_enabled,
            trace_sharing_enabled=trace_sharing_enabled,
            primary_intent=primary_intent,
            s_3_endpoint=s_3_endpoint,
            s_3_access_key_id=s_3_access_key_id,
            s_3_secret_access_key=s_3_secret_access_key,
            s_3_bucket=s_3_bucket,
        )

        update_organization_body.additional_properties = d
        return update_organization_body

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
