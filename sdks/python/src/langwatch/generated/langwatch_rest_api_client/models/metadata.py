from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Metadata")


@_attrs_define
class Metadata:
    """
    Attributes:
        thread_id (None | str | Unset):
        user_id (None | str | Unset):
        customer_id (None | str | Unset):
        labels (list[str] | None | Unset):
        topic_id (None | str | Unset):
        subtopic_id (None | str | Unset):
        sdk_name (None | str | Unset):
        sdk_version (None | str | Unset):
        sdk_language (None | str | Unset):
        telemetry_sdk_language (None | str | Unset):
        telemetry_sdk_name (None | str | Unset):
        telemetry_sdk_version (None | str | Unset):
        prompt_ids (list[str] | None | Unset):
        prompt_version_ids (list[str] | None | Unset):
    """

    thread_id: None | str | Unset = UNSET
    user_id: None | str | Unset = UNSET
    customer_id: None | str | Unset = UNSET
    labels: list[str] | None | Unset = UNSET
    topic_id: None | str | Unset = UNSET
    subtopic_id: None | str | Unset = UNSET
    sdk_name: None | str | Unset = UNSET
    sdk_version: None | str | Unset = UNSET
    sdk_language: None | str | Unset = UNSET
    telemetry_sdk_language: None | str | Unset = UNSET
    telemetry_sdk_name: None | str | Unset = UNSET
    telemetry_sdk_version: None | str | Unset = UNSET
    prompt_ids: list[str] | None | Unset = UNSET
    prompt_version_ids: list[str] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        thread_id: None | str | Unset
        if isinstance(self.thread_id, Unset):
            thread_id = UNSET
        else:
            thread_id = self.thread_id

        user_id: None | str | Unset
        if isinstance(self.user_id, Unset):
            user_id = UNSET
        else:
            user_id = self.user_id

        customer_id: None | str | Unset
        if isinstance(self.customer_id, Unset):
            customer_id = UNSET
        else:
            customer_id = self.customer_id

        labels: list[str] | None | Unset
        if isinstance(self.labels, Unset):
            labels = UNSET
        elif isinstance(self.labels, list):
            labels = self.labels

        else:
            labels = self.labels

        topic_id: None | str | Unset
        if isinstance(self.topic_id, Unset):
            topic_id = UNSET
        else:
            topic_id = self.topic_id

        subtopic_id: None | str | Unset
        if isinstance(self.subtopic_id, Unset):
            subtopic_id = UNSET
        else:
            subtopic_id = self.subtopic_id

        sdk_name: None | str | Unset
        if isinstance(self.sdk_name, Unset):
            sdk_name = UNSET
        else:
            sdk_name = self.sdk_name

        sdk_version: None | str | Unset
        if isinstance(self.sdk_version, Unset):
            sdk_version = UNSET
        else:
            sdk_version = self.sdk_version

        sdk_language: None | str | Unset
        if isinstance(self.sdk_language, Unset):
            sdk_language = UNSET
        else:
            sdk_language = self.sdk_language

        telemetry_sdk_language: None | str | Unset
        if isinstance(self.telemetry_sdk_language, Unset):
            telemetry_sdk_language = UNSET
        else:
            telemetry_sdk_language = self.telemetry_sdk_language

        telemetry_sdk_name: None | str | Unset
        if isinstance(self.telemetry_sdk_name, Unset):
            telemetry_sdk_name = UNSET
        else:
            telemetry_sdk_name = self.telemetry_sdk_name

        telemetry_sdk_version: None | str | Unset
        if isinstance(self.telemetry_sdk_version, Unset):
            telemetry_sdk_version = UNSET
        else:
            telemetry_sdk_version = self.telemetry_sdk_version

        prompt_ids: list[str] | None | Unset
        if isinstance(self.prompt_ids, Unset):
            prompt_ids = UNSET
        elif isinstance(self.prompt_ids, list):
            prompt_ids = self.prompt_ids

        else:
            prompt_ids = self.prompt_ids

        prompt_version_ids: list[str] | None | Unset
        if isinstance(self.prompt_version_ids, Unset):
            prompt_version_ids = UNSET
        elif isinstance(self.prompt_version_ids, list):
            prompt_version_ids = self.prompt_version_ids

        else:
            prompt_version_ids = self.prompt_version_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if thread_id is not UNSET:
            field_dict["thread_id"] = thread_id
        if user_id is not UNSET:
            field_dict["user_id"] = user_id
        if customer_id is not UNSET:
            field_dict["customer_id"] = customer_id
        if labels is not UNSET:
            field_dict["labels"] = labels
        if topic_id is not UNSET:
            field_dict["topic_id"] = topic_id
        if subtopic_id is not UNSET:
            field_dict["subtopic_id"] = subtopic_id
        if sdk_name is not UNSET:
            field_dict["sdk_name"] = sdk_name
        if sdk_version is not UNSET:
            field_dict["sdk_version"] = sdk_version
        if sdk_language is not UNSET:
            field_dict["sdk_language"] = sdk_language
        if telemetry_sdk_language is not UNSET:
            field_dict["telemetry_sdk_language"] = telemetry_sdk_language
        if telemetry_sdk_name is not UNSET:
            field_dict["telemetry_sdk_name"] = telemetry_sdk_name
        if telemetry_sdk_version is not UNSET:
            field_dict["telemetry_sdk_version"] = telemetry_sdk_version
        if prompt_ids is not UNSET:
            field_dict["prompt_ids"] = prompt_ids
        if prompt_version_ids is not UNSET:
            field_dict["prompt_version_ids"] = prompt_version_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_thread_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        thread_id = _parse_thread_id(d.pop("thread_id", UNSET))

        def _parse_user_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        user_id = _parse_user_id(d.pop("user_id", UNSET))

        def _parse_customer_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        customer_id = _parse_customer_id(d.pop("customer_id", UNSET))

        def _parse_labels(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                labels_type_0 = cast(list[str], data)

                return labels_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        labels = _parse_labels(d.pop("labels", UNSET))

        def _parse_topic_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        topic_id = _parse_topic_id(d.pop("topic_id", UNSET))

        def _parse_subtopic_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        subtopic_id = _parse_subtopic_id(d.pop("subtopic_id", UNSET))

        def _parse_sdk_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sdk_name = _parse_sdk_name(d.pop("sdk_name", UNSET))

        def _parse_sdk_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sdk_version = _parse_sdk_version(d.pop("sdk_version", UNSET))

        def _parse_sdk_language(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sdk_language = _parse_sdk_language(d.pop("sdk_language", UNSET))

        def _parse_telemetry_sdk_language(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        telemetry_sdk_language = _parse_telemetry_sdk_language(d.pop("telemetry_sdk_language", UNSET))

        def _parse_telemetry_sdk_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        telemetry_sdk_name = _parse_telemetry_sdk_name(d.pop("telemetry_sdk_name", UNSET))

        def _parse_telemetry_sdk_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        telemetry_sdk_version = _parse_telemetry_sdk_version(d.pop("telemetry_sdk_version", UNSET))

        def _parse_prompt_ids(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                prompt_ids_type_0 = cast(list[str], data)

                return prompt_ids_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        prompt_ids = _parse_prompt_ids(d.pop("prompt_ids", UNSET))

        def _parse_prompt_version_ids(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                prompt_version_ids_type_0 = cast(list[str], data)

                return prompt_version_ids_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        prompt_version_ids = _parse_prompt_version_ids(d.pop("prompt_version_ids", UNSET))

        metadata = cls(
            thread_id=thread_id,
            user_id=user_id,
            customer_id=customer_id,
            labels=labels,
            topic_id=topic_id,
            subtopic_id=subtopic_id,
            sdk_name=sdk_name,
            sdk_version=sdk_version,
            sdk_language=sdk_language,
            telemetry_sdk_language=telemetry_sdk_language,
            telemetry_sdk_name=telemetry_sdk_name,
            telemetry_sdk_version=telemetry_sdk_version,
            prompt_ids=prompt_ids,
            prompt_version_ids=prompt_version_ids,
        )

        metadata.additional_properties = d
        return metadata

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
