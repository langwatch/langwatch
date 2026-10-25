package rules

import "encoding/json"

// PresidioPIIDetectionSettings are langevals_presidio's
// PresidioPIIDetectionSettings.
type PresidioPIIDetectionSettings struct {
	Entities     PresidioEntities `json:"entities"      desc:"The types of PII to check for in the input."`
	MinThreshold float64          `json:"min_threshold" desc:"The minimum confidence required for failing the evaluation on a PII match."`
}

// PresidioEntities are the PII types to check for.
type PresidioEntities struct {
	CreditCard            bool `json:"credit_card"`
	Crypto                bool `json:"crypto"`
	EmailAddress          bool `json:"email_address"`
	IBANCode              bool `json:"iban_code"`
	IPAddress             bool `json:"ip_address"`
	Location              bool `json:"location"`
	Person                bool `json:"person"`
	PhoneNumber           bool `json:"phone_number"`
	MedicalLicense        bool `json:"medical_license"`
	USBankNumber          bool `json:"us_bank_number"`
	USDriverLicense       bool `json:"us_driver_license"`
	USITIN                bool `json:"us_itin"`
	USPassport            bool `json:"us_passport"`
	USSSN                 bool `json:"us_ssn"`
	UKNHS                 bool `json:"uk_nhs"`
	SGNRICFIN             bool `json:"sg_nric_fin"`
	AUABN                 bool `json:"au_abn"`
	AUACN                 bool `json:"au_acn"`
	AUTFN                 bool `json:"au_tfn"`
	AUMedicare            bool `json:"au_medicare"`
	INPAN                 bool `json:"in_pan"`
	INAadhaar             bool `json:"in_aadhaar"`
	INVehicleRegistration bool `json:"in_vehicle_registration"`
	INVoter               bool `json:"in_voter"`
	INPassport            bool `json:"in_passport"`
}

// DefaultPresidioPIIDetectionSettings are the Python defaults.
func DefaultPresidioPIIDetectionSettings() PresidioPIIDetectionSettings {
	return PresidioPIIDetectionSettings{
		Entities: PresidioEntities{
			CreditCard: true, Crypto: true, EmailAddress: true, IBANCode: true, IPAddress: true,
			PhoneNumber: true, MedicalLicense: true,
		},
		MinThreshold: 0.5,
	}
}

// ParsePresidioPIIDetectionSettings parses presidio/pii_detection settings.
func ParsePresidioPIIDetectionSettings(raw json.RawMessage) (PresidioPIIDetectionSettings, error) {
	return ParseSettings(raw, DefaultPresidioPIIDetectionSettings())
}

// presidioPIIDetectionDefinition is presidio/pii_detection in the catalogue.
func presidioPIIDetectionDefinition() Definition {
	return Definition{
		Slug: "presidio/pii_detection",
		Name: "Presidio PII Detection",
		Description: `
Detects personally identifiable information in text, including phone numbers, email addresses, and
social security numbers. It allows customization of the detection threshold and the specific types of PII to check.
`,
		Category:        "safety",
		DocsURL:         "https://microsoft.github.io/presidio",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput},
		Result:          ResultDescriptions{Score: "Amount of PII detected, 0 means no PII detected", Passed: "If true then no PII was detected, if false then at least one PII was detected"},
		DefaultSettings: DefaultPresidioPIIDetectionSettings(),
	}
}
