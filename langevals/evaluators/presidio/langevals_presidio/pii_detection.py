import json
import os
from typing import Any, Literal, Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResult,
    EvaluationResultSkipped,
)
from pydantic import BaseModel, Field
import spacy
import spacy.cli
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_analyzer.nlp_engine import SpacyNlpEngine


class PresidioPIIDetectionEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class PresidioEntities(BaseModel):
    credit_card: bool = True
    crypto: bool = True
    email_address: bool = True
    iban_code: bool = True
    ip_address: bool = True
    location: bool = False
    person: bool = False
    phone_number: bool = True
    medical_license: bool = True
    us_bank_number: bool = False
    us_driver_license: bool = False
    us_itin: bool = False
    us_passport: bool = False
    us_ssn: bool = False
    uk_nhs: bool = False
    sg_nric_fin: bool = False
    au_abn: bool = False
    au_acn: bool = False
    au_tfn: bool = False
    au_medicare: bool = False
    in_pan: bool = False
    in_aadhaar: bool = False
    in_vehicle_registration: bool = False
    in_voter: bool = False
    in_passport: bool = False


class PresidioPIIDetectionSettings(EvaluatorSettings):
    entities: PresidioEntities = Field(
        default=PresidioEntities(),
        description="The types of PII to check for in the input.",
    )
    min_threshold: float = Field(
        default=0.5,
        description="The minimum confidence required for failing the evaluation on a PII match.",
    )


class PresidioPIIDetectionResult(EvaluationResult):
    score: float = Field(description="Amount of PII detected, 0 means no PII detected")
    passed: Optional[bool] = Field(
        description="If true then no PII was detected, if false then at least one PII was detected",
        default=None,
    )
    raw_response: dict[str, Any]


class PresidioPIIDetectionEvaluator(
    BaseEvaluator[
        PresidioPIIDetectionEntry,
        PresidioPIIDetectionSettings,
        PresidioPIIDetectionResult,
    ]
):
    """
    Detects personally identifiable information in text, including phone numbers, email addresses, and
    social security numbers. It allows customization of the detection threshold and the specific types of PII to check.
    """

    name = "Presidio PII Detection"
    category = "safety"
    env_vars = []
    default_settings = PresidioPIIDetectionSettings()
    docs_url = "https://microsoft.github.io/presidio"
    is_guardrail = True

    @classmethod
    def preload(cls):
        # Try loading in order: 1) as installed package, 2) from cache, 3) download
        model_loaded = False
        cache_dir = os.path.join(os.path.dirname(__file__), ".cache")

        # First, try loading as an installed package (when en-core-web-lg is a dependency)
        try:
            spacy.load("en_core_web_lg")
            model_loaded = True
        except OSError:
            pass

        # Second, try loading from local cache
        if not model_loaded:
            os.makedirs(cache_dir, exist_ok=True)
            try:
                spacy.load(os.path.join(cache_dir, "en_core_web_lg"))
                model_loaded = True
            except OSError:
                pass

        # Last resort: download and cache
        if not model_loaded:
            spacy.cli.download("en_core_web_lg", False, False, "--no-cache-dir")  # type: ignore
            nlp = spacy.load("en_core_web_lg")
            nlp.to_disk(os.path.join(cache_dir, "en_core_web_lg"))

        cls.analyzer = AnalyzerEngine(
            nlp_engine=SpacyNlpEngine(
                models=[{"lang_code": "en", "model_name": "en_core_web_lg"}]
            )
        )

        super().preload()

    def evaluate(self, entry: PresidioPIIDetectionEntry) -> SingleEvaluationResult:
        content = "\n\n".join([entry.input or "", entry.output or ""]).strip()
        try:
            json.loads(content)
            content = (
                content.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
            )
            is_valid_json = True
        except:
            is_valid_json = False

        if not content:
            return EvaluationResultSkipped(details="Input and output are both empty")

        settings_entities = self.settings.entities.model_dump()
        entities = [
            info_type.upper()
            for info_type in settings_entities.keys()
            if settings_entities[info_type]
        ]

        if len(content) > 524288:
            raise ValueError(
                "Content exceeds the maximum length of 524288 bytes allowed by PII Detection"
            )

        results = self.analyzer.analyze(text=content, entities=entities, language="en")
        results = [
            result for result in results if result.score >= self.settings.min_threshold
        ]

        findings = [
            f"{result.entity_type} (likelihood: {result.score})" for result in results
        ]

        anonymizer = AnonymizerEngine()
        anonymized_text = anonymizer.anonymize(
            text=content,
            analyzer_results=results,  # type: ignore
        ).text

        if is_valid_json:
            anonymized_text = (
                anonymized_text.replace("\n", "\\n")
                .replace("\t", "\\t")
                .replace("\r", "\\r")
            )

        serialized_results = [result.to_dict() for result in results]

        return PresidioPIIDetectionResult(
            score=len(results),
            passed=len(results) == 0,
            details=(
                None if len(results) == 0 else f"PII detected: {', '.join(findings)}"
            ),
            raw_response={
                "results": serialized_results,
                "anonymized": anonymized_text,
            },
        )
