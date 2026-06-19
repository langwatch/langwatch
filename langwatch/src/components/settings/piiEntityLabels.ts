/**
 * Human-readable labels for the PII entities each redaction level detects,
 * shown in the rule drawer's level tooltips. Pure constants so the settings
 * bundle never pulls in the server-side redaction engine; a unit test pins
 * each map to the engine's entity list so the copy cannot drift from what is
 * actually detected.
 */

/** Entities the essential level detects natively (pattern + checksum based). */
export const ESSENTIAL_PII_ENTITY_LABELS: Record<string, string> = {
  EMAIL_ADDRESS: "Email addresses",
  PHONE_NUMBER: "Phone numbers",
  CREDIT_CARD: "Credit card numbers",
  IP_ADDRESS: "IP addresses",
  IBAN_CODE: "IBAN account numbers",
  CRYPTO: "Crypto wallet addresses",
  US_SSN: "US Social Security numbers",
  US_ITIN: "US taxpayer IDs (ITIN)",
  US_PASSPORT: "US passport numbers",
  US_BANK_NUMBER: "US bank account numbers",
  US_DRIVER_LICENSE: "US driver's licenses",
  MEDICAL_LICENSE: "Medical license numbers",
  UK_NHS: "UK NHS numbers",
  SG_NRIC_FIN: "Singapore NRIC/FIN",
  AU_ABN: "Australian business numbers (ABN)",
  AU_TFN: "Australian tax file numbers (TFN)",
  IN_PAN: "Indian PAN",
  IN_AADHAAR: "Indian Aadhaar numbers",
  BR_CPF: "Brazilian CPF",
};

/** Entities the strict level adds on top of essential. */
export const STRICT_ADDED_PII_ENTITY_LABELS: Record<string, string> = {
  PERSON: "Person names",
  LOCATION: "Locations and addresses",
  AU_ACN: "Australian company numbers (ACN)",
  AU_MEDICARE: "Australian Medicare numbers",
  IN_PASSPORT: "Indian passport numbers",
  IN_VEHICLE_REGISTRATION: "Indian vehicle registrations",
  IN_VOTER: "Indian voter IDs",
};

export const ESSENTIAL_PII_SUMMARY = Object.values(
  ESSENTIAL_PII_ENTITY_LABELS,
).join(", ");

export const STRICT_ADDED_PII_SUMMARY = Object.values(
  STRICT_ADDED_PII_ENTITY_LABELS,
).join(", ");
