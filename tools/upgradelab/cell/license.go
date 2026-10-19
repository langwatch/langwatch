package cell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The test-suite license pair at the release upgraded from: main verifies ENTERPRISE_LICENSE_KEY with TEST_PUBLIC_KEY.
const (
	licenseFixtures = "platform/app/ee/licensing/__tests__/fixtures"
	licensedShape   = "sh-licensed"
)

var (
	testPublicKey     = regexp.MustCompile("(?s)export const TEST_PUBLIC_KEY = `(-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----)`")
	enterpriseKeyLine = regexp.MustCompile(`(?s)export const ENTERPRISE_LICENSE_KEY =\s*"([A-Za-z0-9+/=]+)"`)
)

// TestLicense is the enterprise license a self-hosted licensed cell uploads, and the public key both releases verify it with.
type TestLicense struct{ PublicKey, Key string }

// ReadTestLicense reads the pair from the checkout's licensing fixtures.
func ReadTestLicense(checkout string) (TestLicense, error) {
	keys, err := os.ReadFile(filepath.Join(checkout, licenseFixtures, "testKeys.ts")) // #nosec G304 -- the cell's own checkout.
	if err != nil {
		return TestLicense{}, err
	}
	licenses, err := os.ReadFile(filepath.Join(checkout, licenseFixtures, "testLicenses.ts")) // #nosec G304 -- the cell's own checkout.
	if err != nil {
		return TestLicense{}, err
	}
	return ParseTestLicense(string(keys), string(licenses))
}

// ParseTestLicense picks TEST_PUBLIC_KEY and ENTERPRISE_LICENSE_KEY out of the two fixture sources.
func ParseTestLicense(keys, licenses string) (TestLicense, error) {
	publicKey := testPublicKey.FindStringSubmatch(keys)
	key := enterpriseKeyLine.FindStringSubmatch(licenses)
	if publicKey == nil || key == nil {
		return TestLicense{}, errors.New("TEST_PUBLIC_KEY or ENTERPRISE_LICENSE_KEY not found in the licensing fixtures")
	}
	return TestLicense{PublicKey: strings.TrimSpace(publicKey[1]), Key: key[1]}, nil
}

// licensed: a self-hosted licensed shape gets its enterprise plan through the license, never a Subscription row.
func (cell *run) licensed() bool { return cell.profile.Shape == licensedShape }

// grantEnterprise gives an organization the enterprise plan the way its deployment does: a license uploaded through
// main's door on self-hosted, the Stripe subscription row (SQL; Stripe has no lab door) on cloud.
func (cell *run) grantEnterprise(ctx context.Context, org, subscription string) error {
	if !cell.licensed() {
		//nolint:dupword // SQL: createdAt, updatedAt and startDate each take now()
		_, err := cell.orgSQLFor(ctx, org, `INSERT INTO mydb."Subscription" (id, "organizationId", plan, status, "startDate", "createdAt", "updatedAt") VALUES (`+sqlQuote(subscription)+`, %s, 'ENTERPRISE', 'ACTIVE', now(), now(), now())`)
		if err != nil {
			return fmt.Errorf("enterprise subscription (SQL): %w", err)
		}
		return nil
	}
	if cell.licensedOrgs[org] {
		return nil
	}
	if cell.license.Key == "" {
		return errors.New("license upload: no test license read from the release's fixtures")
	}
	if err := cell.seeder.Call(ctx, true, "license.upload", map[string]any{"organizationId": org, "licenseKey": cell.license.Key}, nil); err != nil {
		return fmt.Errorf("license.upload: %w", err)
	}
	cell.licensedOrgs[org] = true
	return nil
}

// licenseVerdict (E1) for a licensed cell: the copy step settled and every organization main licensed keeps its key.
func (cell *run) licenseVerdict(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.licensed() {
		return nil
	}
	lost, err := LicensesLost(ctx, cell.stores.psqlURL(), "mydb")
	if err != nil {
		lost = -1
	}
	judged := judgeLicense(SelfHostedRun{Licensed: true, Ledger: final, LicenseLost: lost})
	judged.Detail += fmt.Sprintf("; %d organizations licensed on main through license.upload", len(cell.licensedOrgs))
	return []Verdict{judged}
}
