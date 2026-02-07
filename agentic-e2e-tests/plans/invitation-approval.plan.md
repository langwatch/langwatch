# Test Plan: Invitation Approval Workflow

**Feature specification:** `specs/members/update-pending-invitation.feature`

## Overview

Tests the two-tier invitation system:
- **Admins** create direct invites (PENDING status, immediate)
- **Members** request invites (WAITING_APPROVAL status, needs admin approval)
- **Admins** can approve/reject pending requests

Members page: `/settings/members`

**Environment:**
- App runs on `http://localhost:5560`
- Auth setup creates ADMIN test user
- No email provider configured → submit button reads "Create invites"
- Chakra UI may render duplicate dialogs → use `.last()`

## Suite 1: Admin Creates Immediate Invite

**File:** `tests/members/admin-creates-immediate-invite.spec.ts`

### Test: Admin invites a new member with MEMBER role

**Source:** lines 19-24

1. Navigate to `/settings/members`
2. Click "Add members" button
3. Type `direct@example.com` in Email input
4. Keep default "Member" org role
5. Click "Create invites"
6. Wait for success toast
7. Close invite link dialog if shown
8. Verify `direct@example.com` appears in "Sent Invites" section

## Suite 2: Admin Approves Pending Request

**File:** `tests/members/admin-approves-invitation.spec.ts`

### Test: Approve a pending invitation request

**Source:** lines 27-33

1. **Seed:** Create WAITING_APPROVAL invite for `waiting@example.com` via tRPC API
2. Navigate to `/settings/members`
3. Verify "Pending Approval" section visible
4. Click "Approve" button in `waiting@example.com` row
5. Wait for "Invitation approved" toast
6. Verify `waiting@example.com` moves to "Sent Invites"

## Suite 3: Admin Rejects Pending Request

**File:** `tests/members/admin-rejects-invitation.spec.ts`

### Test: Reject a pending invitation request

**Source:** lines 36-42

1. **Seed:** Create WAITING_APPROVAL invite for `reject@example.com` via tRPC API
2. Navigate to `/settings/members`
3. Verify "Pending Approval" section visible
4. Click "Reject" button in `reject@example.com` row
5. Wait for "Invitation rejected" toast
6. Verify `reject@example.com` removed from all sections

## Suite 4: Member Creates Invitation Request

**File:** `tests/members/member-creates-invitation-request.spec.ts`

**Note:** Requires MEMBER-role user. Create second user, invite to org as MEMBER, authenticate separately.

### Test: Member requests invitation that goes to Pending Approval

**Source:** lines 11-16

1. Navigate to `/settings/members` as MEMBER user
2. Click "Add members"
3. Type `newuser@example.com` in Email input
4. Verify role dropdown shows only "Member" and "Lite Member"
5. Click "Create invites"
6. Wait for "Invitation sent for approval" toast
7. Verify `newuser@example.com` appears in "Pending Approval" section
8. Verify row shows "Waiting for admin approval" text

## Step Definitions

```typescript
givenIAmOnTheMembersPage(page)     // Navigate to /settings/members
whenIClickAddMembers(page)          // Click "Add members" button
whenIFillEmailWith(page, email)     // Fill email input
whenISelectOrgRole(page, role)      // Select role dropdown
whenIClickCreateInvites(page)       // Click submit button
whenIApproveInvitationFor(page, email)  // Click Approve in row
whenIRejectInvitationFor(page, email)   // Click Reject in row
thenISeeSentInviteFor(page, email)      // Assert in Sent Invites
thenISeePendingApprovalFor(page, email) // Assert in Pending Approval
thenISeeSuccessToast(page, title)       // Assert toast appears
seedWaitingApprovalInvite(page, email)  // Create via tRPC API
```

## Toast Messages (actual implementation)

- Admin invite: "Invite created successfully" / "All invites have been created..."
- Member request: "Invitation sent for approval" / "An admin will review..."
- Approve: "Invitation approved" / "The invitation has been approved and sent."
- Reject: "Invitation rejected" / "The invitation request has been rejected."
