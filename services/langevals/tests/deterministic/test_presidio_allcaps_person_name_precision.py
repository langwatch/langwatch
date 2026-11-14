"""False PERSON and LOCATION spans over ALL-CAPS strings that are not people.

Red means the second pass invents people or places: fix the rule, never the
corpus or the list. History: specs/evaluators/langevals-presidio-allcaps-person-names.feature
"""

import json

import pytest
from langevals_presidio.allcaps_names import normalise_allcaps_runs
from langevals_presidio.pii_detection import PresidioEntities
from presidio_person_name_support import (
    LENGTH_BAND,
    MIN_THRESHOLD,
    analyze_calls,
    person_spans,
    second_pass_places,
)

# Every false positive accepted, by reference code; a third fails the build.
# M-8802 predates the second pass. P-9920 is a product line named after its
# founder, so it reads as a name because it holds one.
KNOWN_FALSE_POSITIVES = frozenset({"M-8802", "P-9920"})

# Normalisation deliberately leaves these alone, so they cannot carry the
# second pass. They are controls for that, not gaps in the corpus.
UNCHANGED_BY_DESIGN = frozenset({"ACME_CORP_LTD"})

# ALL-CAPS strings that are not people. Every one names a thing: a company, a
# carrier, a team, a part, a code, a currency, an acronym or a heading.
PRECISION_CORPUS: dict[str, list[str]] = {
    "merchant_and_counterparty": [
        '{"txn": "T-4410", "merchant": "NORTHGATE HARDWARE SUPPLY", "note": "The payment to the store was settled on the same day without any dispute."}',
        '{"txn": "T-4411", "merchant": "BLUE RIDGE COFFEE ROASTERS", "note": "The customer asked whether the subscription renews at the end of this month."}',
        '{"txn": "T-4412", "counterparty": "MERIDIAN CAPITAL PARTNERS", "note": "The transfer cleared overnight and the balance now shows as available."}',
        '{"txn": "T-4413", "counterparty": "HARBOURSIDE TRADING COMPANY", "note": "The settlement date was moved forward by one working day on request."}',
        '{"txn": "T-4414", "merchant": "GOLDEN FIELDS GARDEN CENTRE", "note": "A refund was raised for the damaged item and should appear within a week."}',
    ],
    "carriers": [
        '{"ref": "R-7701", "carrier": "GLOBAL FREIGHT EXPRESS", "note": "The parcel was scanned at the depot and is expected to arrive within two days."}',
        '{"ref": "R-7702", "carrier": "SWIFT OVERLAND LOGISTICS", "note": "The driver attempted delivery twice and left a card at the front door."}',
        '{"ref": "R-7703", "carrier": "ATLANTIC PARCEL NETWORK", "note": "The consignment is held at customs pending a copy of the commercial invoice."}',
        '{"ref": "R-7704", "carrier": "MIDLAND PALLET HAULAGE", "note": "The collection slot was rebooked because the loading bay was still blocked."}',
    ],
    "departments": [
        '{"case": "C-2201", "dept": "CUSTOMER RETENTION TEAM", "note": "The enquiry was escalated so that the renewal discount could be applied."}',
        '{"case": "C-2202", "dept": "ACCOUNTS RECEIVABLE DESK", "note": "The outstanding balance was reconciled against the remittance advice."}',
        '{"case": "C-2203", "dept": "QUALITY ASSURANCE REVIEW BOARD", "note": "The sample batch was re-tested before the shipment was released."}',
        '{"case": "C-2204", "dept": "FIELD SERVICE DISPATCH", "note": "An engineer visit was booked for the following morning at the depot site."}',
    ],
    "product_skus": [
        '{"order": "O-9001", "sku": "WIDGET PRO MAX", "note": "The replacement unit was dispatched after the original item failed inspection."}',
        '{"order": "O-9002", "sku": "TITAN GRIP ANCHOR BOLT", "note": "The part is back in stock and the queued order will ship this afternoon."}',
        '{"order": "O-9003", "sku": "AURORA DESK LAMP SLIM", "note": "The shade arrived cracked so a fresh one was picked from the reserve bin."}',
        '{"order": "O-9004", "model": "RANGER TRAIL BOOT GTX", "note": "The size exchange was approved and the return label has now been emailed."}',
        '{"order": "O-9005", "label": "ACME_CORP_LTD", "note": "The underscored identifier must survive the analysis exactly as it was written."}',
        # RAM and BIN are also listed surnames; beside an everyday word they are parts.
        '{"order": "O-9006", "body": "Order 4412: RAM MODULE replaced, follow-up booked for the next working day at the depot."}',
        '{"order": "O-9007", "body": "Order 4412: BIN LOCATION replaced, follow-up booked for the next working day at the depot."}',
        '{"order": "O-9008", "body": "Order 4412: SKU BIN LOCATION A4 MAN HOURS replaced, follow-up booked for the next working day at the depot."}',
    ],
    "notice_and_status_codes": [
        '{"ref": "N-5501", "code": "INVOICE OVERDUE NOTICE", "note": "A reminder was issued because the balance has not been cleared for ten days."}',
        '{"ref": "N-5502", "code": "PAYMENT DECLINED RETRY LATER", "note": "The card issuer refused the charge and no funds have been taken."}',
        '{"ref": "N-5503", "status": "AWAITING CUSTOMER RESPONSE", "note": "The ticket closes automatically if nothing is heard within five days."}',
        '{"ref": "N-5504", "status": "SHIPMENT DELAYED AT HUB", "note": "The onward leg was rescheduled after the weather warning had been lifted."}',
        '{"ref": "N-5505", "code": "HTTP 503 SERVICE UNAVAILABLE", "note": "The upstream gateway refused the call and the retry queue drained later."}',
    ],
    "country_and_currency_codes": [
        '{"ledger": "L-3301", "pair": "USD EUR GBP CHF JPY", "note": "The quoted rate held for the whole session and no revaluation was needed."}',
        '{"ledger": "L-3302", "markets": "GB DE FR NL SE NO DK", "note": "The regional rollout was signed off for the next quarter as was planned."}',
        '{"ledger": "L-3303", "rails": "IBAN BIC SWIFT SEPA ACH", "note": "The payment rails were listed in the onboarding pack for the finance team."}',
        '{"ledger": "L-3304", "pair": "AUD NZD SGD HKD CAD", "note": "The hedge was unwound once the exposure fell under the reporting floor."}',
    ],
    "acronym_heavy_prose": [
        '{"memo": "M-8801", "body": "The SLA and the KPI dashboard were reviewed by the PMO before the CAB signed off on the change request for the ERP rollout."}',
        '{"memo": "M-8802", "body": "The API and the SDK were both bumped, and the CI pipeline now runs the E2E suite before any PR can merge into the trunk."}',
        '{"memo": "M-8803", "body": "The RFP was issued to three vendors, and the SOW will follow once the NDA and the DPA have been countersigned by both sides."}',
        '{"memo": "M-8804", "body": "The CTO asked the CFO whether the ROI on the CRM migration still held after the VAT change, so the model was re-run."}',
        '{"memo": "M-8805", "body": "The DNS and the TLS certificates were rotated, the CDN cache was purged, and the SRE on call confirmed no SLO was breached."}',
    ],
    "allcaps_headings": [
        '{"doc": "D-6601", "heading": "TERMS AND CONDITIONS OF SALE", "body": "The clause about late delivery was amended in the most recent revision."}',
        '{"doc": "D-6602", "heading": "IMPORTANT SAFETY INFORMATION", "body": "The warning about wet surfaces moved to the first page of the leaflet."}',
        '{"doc": "D-6603", "heading": "ANNUAL REPORT AND ACCOUNTS", "body": "The segment breakdown now lists the retail and wholesale lines apart."}',
        '{"doc": "D-6604", "heading": "NOTICE OF SCHEDULED MAINTENANCE", "body": "The window moved to the weekend so the batch run would not clash."}',
        '{"doc": "D-6605", "heading": "RETURNS AND REFUNDS POLICY", "body": "The thirty day period now starts at the delivery date, not the order date."}',
        '{"doc": "D-6606", "heading": "CHAPTER FOUR: WORKING AT HEIGHT", "body": "The ladder inspection record must be signed before each shift begins."}',
    ],
    # Places, institutions and products the side-by-side clause also reaches.
    # Reference codes avoid T-4420 and P-9910: the first pass alone reads those as people.
    "particle_non_names": [
        '{"txn": "T-4430", "merchant": "UNIVERSIDAD DE LA FRONTERA", "note": "The tuition instalment was taken on the agreed date without a dispute."}',
        '{"txn": "T-4421", "merchant": "BANCO DEL LITORAL ORIENTE", "note": "The transfer cleared overnight and the balance now shows as available."}',
        '{"ref": "R-7710", "site": "PUERTO DE LAS PALMAS TERMINAL", "note": "The container was scanned at the gate and released the following morning."}',
        '{"doc": "D-6610", "heading": "CIUDAD DE LOS REYES ZONING PLAN", "body": "The consultation period was extended by a further three working weeks."}',
        '{"part": "P-9920", "line": "VAN DER HEIDE SEALING RANGE", "note": "The gasket set is listed under the industrial catalogue for this quarter."}',
        '{"ref": "R-7711", "site": "AL FURJAN DISTRIBUTION CENTRE", "note": "The pallet was held at the hub overnight and moved out on the early run."}',
        '{"doc": "D-6611", "heading": "ST ANDREW INDUSTRIAL ESTATE RULES", "body": "The parking allocation per unit was revised in the most recent notice."}',
        '{"part": "P-9911", "line": "TEN BRINK CONVEYOR COMPONENTS", "note": "The roller assembly is stocked in both widths for the coming season."}',
    ],
    # Non-places where a place would go. Without the name-word rule the second
    # pass reads each one as a LOCATION, so these are what make that check bite.
    "place_context_non_names": [
        '{"doc": "D-6701", "body": "The stock was moved to API KEY overnight and the count matched the system record at the morning check."}',
        '{"doc": "D-6702", "body": "The stock was moved to DPD CLASSIC overnight and the count matched the system record at the morning check."}',
        '{"doc": "D-6703", "body": "The stock was moved to MOUNTAIN PEAK GEAR overnight and the count matched the system record at the morning check."}',
        '{"doc": "D-6704", "body": "The stock was moved to NORTHERN LIGHTS overnight and the count matched the system record at the morning check."}',
        '{"doc": "D-6705", "body": "The stock was moved to BIN LOCATION overnight and the count matched the system record at the morning check."}',
    ],
}


def cases() -> list[tuple[str, str]]:
    """(category, text) for every case, in a stable order."""
    return [
        (category, text)
        for category, texts in PRECISION_CORPUS.items()
        for text in texts
    ]


def reference(text: str) -> str:
    """The case's reference code, the first value in its JSON."""
    return next(iter(json.loads(text).values()))


def test_precision_corpus_is_not_vacuous():
    """A corpus with no ALL-CAPS run would measure nothing at all."""
    assert len(cases()) >= 30, "too few cases for a precision figure"
    assert len(PRECISION_CORPUS) == 10, "one category per shape tenants send"

    for category, text in cases():
        assert LENGTH_BAND[0] <= len(text) <= LENGTH_BAND[1], (
            f"{category}: {len(text)} chars is outside {LENGTH_BAND}: {text!r}"
        )
        json.loads(text)
        assert text == text.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
        if not any(token in text for token in UNCHANGED_BY_DESIGN):
            assert normalise_allcaps_runs(text) != text, (
                f"{category}: no ALL-CAPS run, so the second pass never runs: {text!r}"
            )

    assert len({text for _, text in cases()}) == len(cases()), "duplicate case"
    references = [reference(text) for _, text in cases()]
    assert len(set(references)) == len(references), "duplicate reference code"
    assert KNOWN_FALSE_POSITIVES <= set(references), "a known case left the corpus"


def test_false_positive_table():
    """The per-category count, and no false positive outside the known list."""
    header = f"{'category':<30}{'cases':>7}{'false PERSON':>14}"
    print(f"\nFalse PERSON hits on ALL-CAPS non-names, min_threshold={MIN_THRESHOLD}")
    print(header)
    print("-" * len(header))
    total = 0
    for category, texts in PRECISION_CORPUS.items():
        hits = sum(1 for text in texts if person_spans(text))
        total += hits
        print(f"{category:<30}{len(texts):>7}{hits:>14}")
    print("-" * len(header))
    print(f"{'total':<30}{len(cases()):>7}{total:>14}")

    found = {reference(text) for _, text in cases() if person_spans(text)}
    assert found <= KNOWN_FALSE_POSITIVES, f"new false PERSON: {found - KNOWN_FALSE_POSITIVES}"
    assert found == KNOWN_FALSE_POSITIVES, f"fixed, drop from the list: {KNOWN_FALSE_POSITIVES - found}"


# @scenario "An ALL-CAPS string that is not a name is not read as a person"
@pytest.mark.parametrize(
    "index",
    [
        pytest.param(
            index,
            marks=pytest.mark.xfail(strict=True, reason=f"known false positive: {reference(text)}"),
        )
        if reference(text) in KNOWN_FALSE_POSITIVES
        else index
        for index, (_, text) in enumerate(cases())
    ],
)
def test_no_false_person_on_allcaps_non_name(index: int):
    category, text = cases()[index]
    spans = person_spans(text)
    assert not spans, (
        f"{category}: PERSON span on a non-name. "
        f"Covered: {[text[start:end] for start, end, _ in spans]} in {text!r}"
    )


# @scenario "The second pass adds no place over an ALL-CAPS string that is not one"
@pytest.mark.parametrize("index", range(len(cases())))
def test_no_false_place_from_the_second_pass(index: int):
    """Strict redaction asks for places too, and the second pass looks for them.

    Places the first pass already reports (codes like C-2204) are its own business.
    """
    category, text = cases()[index]
    assert second_pass_places(text) == (), f"{category}: LOCATION on a non-place in {text!r}"


# @scenario "The second pass adds no place over an ALL-CAPS string that is not one"
@pytest.mark.parametrize("text", PRECISION_CORPUS["place_context_non_names"])
def test_place_context_strings_reach_the_second_pass(text: str):
    """Without a second pass the no-place check above has nothing to judge."""
    calls = analyze_calls(
        entities=PresidioEntities(person=True, location=True), text=text
    )
    assert len(calls) == 2, f"no second pass over {text!r}"
