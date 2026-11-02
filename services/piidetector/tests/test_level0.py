"""Level 0 on synthetic text: the detectors run for real."""

from piidetector import combine, level0


def found(text):
    return [(text[s["start"] : s["end"]], s["label"], s["source"]) for s in combine.detect(text, 0)]


class TestLevel0Detectors:
    # @scenario "Level 0 finds structured PII by pattern and checksum"
    def test_reports_email_card_iban_phone_and_ip(self):
        text = (
            "Mail lucie.moreau@example.com, card 4111 1111 1111 1111, "
            "IBAN GB82 WEST 1234 5698 7654 32, call +44 20 7946 0958 from 192.0.2.10."
        )
        assert found(text) == [
            ("lucie.moreau@example.com", "EMAIL", "level0"),
            ("4111 1111 1111 1111", "CREDIT_CARD", "level0"),
            ("GB82 WEST 1234 5698 7654 32", "IBAN", "level0"),
            ("+44 20 7946 0958", "PHONE", "level0"),
            ("192.0.2.10", "IP_ADDRESS", "level0"),
        ]

    # @scenario "Level 0 finds structured PII by pattern and checksum"
    def test_reports_national_ids_that_pass_their_check(self):
        text = "SSN 078-05-1120, DNI 12345678Z, BSN 123456782."
        assert [(t, label) for t, label, _ in found(text)] == [
            ("078-05-1120", "SSN_EQUIVALENT"),
            ("12345678Z", "NATIONAL_ID"),
            ("123456782", "NATIONAL_ID"),
        ]

    # @scenario "A number that fails its checksum is not reported"
    def test_skips_numbers_that_fail_their_checksum(self):
        assert found("card 4111 1111 1111 1112, IBAN GB83 WEST 1234 5698 7654 32") == []

    # @scenario "A number that fails its checksum is not reported"
    def test_skips_a_card_number_after_a_timestamp_key(self):
        assert found("ts=4111111111111111") == []

    # @scenario "A date is a date of birth only after a birth cue"
    def test_reports_a_date_only_after_a_birth_cue(self):
        assert found("Date of birth: 14/07/1988. Meeting on 14/07/2024.") == [("14/07/1988", "DATE_OF_BIRTH", "level0")]

    # @scenario "Level 0 does not report base64 strings or connection strings"
    def test_does_not_report_base64_or_connection_strings(self):
        blob = "dGhpcyBpcyBub3QgYSByZWFsIHNlY3JldCBqdXN0IHRlc3Q5"
        conn = "postgres://app:" + "Pw9x" + "@db.example.com:5432/app"
        text = f"blob {blob} and {conn}"
        labels = {label for _, label, _ in found(text)}
        assert not labels & {"API_KEY", "CONNECTION_STRING"}
        # Both detectors exist and fire when enabled; Level 0 turns them off.
        all_labels = {s["label"] for s in level0.detect(text, level0.FROZEN)}
        assert {"API_KEY", "CONNECTION_STRING"} <= all_labels

    # @scenario "Level 0 does not report base64 strings or connection strings"
    def test_runs_frozen_detectors_without_base64_and_connection_strings(self):
        assert level0.LEVEL0_DETECTORS == level0.FROZEN - {"b64", "conn"}

    # @scenario "Level 0 reports no person names"
    def test_reports_no_person_names(self):
        assert found("Lucie Moreau wrote to Tomasz Nowak about the invoice.") == []


class TestLevel0KeyDetectors:
    # Key-shaped strings are built at run time so no literal in this file looks like a credential.
    def test_reports_a_known_key_prefix(self):
        key = "AKIA" + "Q" * 16
        assert found(f"aws key {key} in the log") == [(key, "API_KEY", "level0")]

    def test_skips_documentation_placeholders(self):
        assert found("aws key " + "AKIA" + "Q" * 9 + "EXAMPLE") == []

    def test_reports_the_value_after_a_password_cue(self):
        value = "Qx" + "7" * 6
        assert found(f"password={value}") == [(value, "PASSWORD", "level0")]


class TestLevel0Dedupe:
    def test_a_span_inside_an_earlier_one_is_dropped(self):
        spans = [
            {"start": 0, "end": 10, "label": "EMAIL"},
            {"start": 2, "end": 5, "label": "PHONE"},
        ]
        assert level0._dedupe(spans) == [{"start": 0, "end": 10, "label": "EMAIL"}]

    def test_an_overlapping_span_with_the_same_label_extends_the_earlier_one(self):
        spans = [
            {"start": 0, "end": 10, "label": "PHONE"},
            {"start": 5, "end": 14, "label": "PHONE"},
            {"start": 8, "end": 20, "label": "EMAIL"},
        ]
        assert level0._dedupe(spans) == [{"start": 0, "end": 14, "label": "PHONE"}]
