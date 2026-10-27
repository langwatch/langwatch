package idpsim

import (
	"fmt"
	"hash/fnv"
	"math/rand/v2"
)

// fillEnterprise gives every user that has none a department, cost center and
// manager. Each draw is keyed on the seed and the user's id, so the same seed
// gives the same person the same fields whatever else changed around them.
// The first user (the seeded admin) is the top of the organization: no manager.
func fillEnterprise(users []*User, seed int64) {
	for i, u := range users {
		if u.Department != "" {
			continue
		}
		h := fnv.New64a()
		_, _ = h.Write([]byte(u.ID))
		//nolint:gosec // G404: predictability is the requirement, not a weakness.
		random := rand.New(rand.NewPCG(uint64(seed), h.Sum64()))
		u.Department = departmentNames[1+random.IntN(len(departmentNames)-1)]
		u.CostCenter = fmt.Sprintf("CC-%04d", 1000+random.IntN(9000))
		if i > 0 {
			u.Manager = users[random.IntN(i)].ID
		}
	}
}

// enterprise is the user's RFC 7643 enterprise extension, or nil when it has none.
func (u *User) enterprise() *SCIMEnterpriseAttrs {
	if u.Department == "" && u.CostCenter == "" && u.Manager == "" {
		return nil
	}
	return &SCIMEnterpriseAttrs{Department: u.Department, CostCenter: u.CostCenter, Manager: u.Manager}
}
