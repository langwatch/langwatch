import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  UserService as UserServiceContract,
  UserNotFoundError,
  createCredentialUserInputSchema,
  createPasskeyUserInputSchema,
  createUserInputSchema,
  removeUserAvatarInputSchema,
  setUserAvatarInputSchema,
  setUserHomePathInputSchema,
  setFirstUserPasswordInputSchema,
  updateUserProfileInputSchema,
  userEmailInputSchema,
  userIdInputSchema,
  userProfilesInputSchema,
  type CreateUserInput,
  type CreateCredentialUserInput,
  type CreatePasskeyUserInput,
  type CreatedUser,
  type RemoveUserAvatarInput,
  type SetUserAvatarInput,
  type SetUserHomePathInput,
  type SetFirstUserPasswordInput,
  type SetFirstUserPasswordResult,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserAvatarResult,
  type UserEmailInput,
  type UserFullProfile,
  type UserPasskeyNudgeStatus,
  type UserIdInput,
  type UserProfile,
  type UserProfilesInput,
  type UserSsoStatus,
  type UserTourPreference,
} from "@langwatch/user-contract";
import type { UserAvatarStoragePort } from "../ports/user.port.ts";
import type { UserRepository } from "../repositories/user.repository.ts";
import { UserAvatarCodecService } from "./user-avatar.service.ts";

export class UserService extends UserServiceContract {
  private readonly avatars = UserAvatarCodecService.create();
  private constructor(
    private readonly repository: UserRepository,
    private readonly organizations: OrganizationApi,
    private readonly avatarStorage: UserAvatarStoragePort,
    /** The issuer every credential account row this service mints is stored under. */
    private readonly credentialIssuer: string,
    private readonly now: () => Date,
  ) {
    super();
  }

  static create(options: {
    repository: UserRepository;
    organizations: OrganizationApi;
    avatarStorage: UserAvatarStoragePort;
    credentialIssuer: string;
    now?: () => Date;
  }): UserService {
    return new UserService(
      options.repository,
      options.organizations,
      options.avatarStorage,
      options.credentialIssuer,
      options.now ?? (() => new Date()),
    );
  }

  getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]> {
    const parsed = userProfilesInputSchema.parse(input);

    return this.repository.getProfiles([...new Set(parsed.userIds)]);
  }

  tryFindById(input: UserIdInput): Promise<UserProfile | null> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.findById(parsed.id);
  }

  tryFindByEmail(input: UserEmailInput): Promise<UserProfile | null> {
    const parsed = userEmailInputSchema.parse(input);

    return this.repository.findByEmail(parsed.email);
  }

  create(input: CreateUserInput): Promise<UserProfile> {
    return this.repository.create(createUserInputSchema.parse(input));
  }

  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    return this.repository.createCredentialUser({
      ...createCredentialUserInputSchema.parse(input),
      issuer: this.credentialIssuer,
    });
  }

  createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser> {
    return this.repository.createPasskeyUser({
      ...createPasskeyUserInputSchema.parse(input),
      issuer: this.credentialIssuer,
    });
  }

  hasPassword(input: UserIdInput): Promise<boolean> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.hasPassword(parsed.id);
  }

  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult> {
    return this.repository.setFirstPassword({
      ...setFirstUserPasswordInputSchema.parse(input),
      issuer: this.credentialIssuer,
    });
  }

  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.getPasskeyNudgeStatus(parsed.id);
  }

  async dismissPasskeyNudge(input: UserIdInput): Promise<void> {
    const parsed = userIdInputSchema.parse(input);
    await this.repository.setPasskeyNudgeDismissedAt({ id: parsed.id, dismissedAt: this.now() });
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const parsed = updateUserProfileInputSchema.parse(input);
    const normalizedEmail =
      parsed.email === undefined ? undefined : parsed.email.trim().toLowerCase();
    const current =
      normalizedEmail === undefined ? null : await this.repository.findById(parsed.id);
    if (normalizedEmail !== undefined && !current) {
      throw new UserNotFoundError(parsed.id);
    }

    const update: UpdateUserProfileInput = { id: parsed.id };
    if (parsed.name !== undefined) {
      update.name = parsed.name;
    }

    if (normalizedEmail !== undefined) {
      update.email = normalizedEmail;
    }

    const updated = await this.repository.updateProfile(update);

    return updated;
  }

  async getAccountInfo(input: UserIdInput): Promise<UserAccountInfo> {
    const parsed = userIdInputSchema.parse(input);
    const account = await this.repository.findAccountInfo(parsed.id);
    if (!account) {
      throw new UserNotFoundError(parsed.id);
    }

    return account;
  }

  getSsoStatus(input: UserIdInput): Promise<UserSsoStatus> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.getSsoStatus(parsed.id);
  }

  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.getTraceExplorerTourPreference(parsed.id);
  }

  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.setTraceExplorerTourDismissedAt({
      id: parsed.id,
      dismissedAt: this.now(),
    });
  }

  async updateLastLogin(input: UserIdInput): Promise<void> {
    const parsed = userIdInputSchema.parse(input);
    await this.repository.setLastLoginAt({ id: parsed.id, lastLoginAt: this.now() });
  }

  tryGetLastHomePath(input: UserIdInput): Promise<string | null> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.findLastHomePath(parsed.id);
  }

  async setLastHomePath(input: SetUserHomePathInput): Promise<void> {
    const parsed = setUserHomePathInputSchema.parse(input);
    await this.repository.setLastHomePath({ id: parsed.id, path: parsed.path });
  }

  async deactivate(input: UserIdInput): Promise<UserProfile> {
    const parsed = userIdInputSchema.parse(input);
    const user = await this.repository.setDeactivatedAt({
      id: parsed.id,
      deactivatedAt: this.now(),
    });

    return user;
  }

  reactivate(input: UserIdInput): Promise<UserProfile> {
    const parsed = userIdInputSchema.parse(input);

    return this.repository.setDeactivatedAt({ id: parsed.id, deactivatedAt: null });
  }

  async setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult> {
    const parsed = setUserAvatarInputSchema.parse(input);
    const { mediaType, bytes } = this.avatars.parse(parsed.imageDataUrl);
    const workspace = await this.organizations.ensurePersonalWorkspace({
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      displayName: parsed.displayName,
      displayEmail: parsed.displayEmail,
    });
    const stored = await this.avatarStorage.store({
      projectId: workspace.project.id,
      userId: parsed.userId,
      mediaType,
      bytes,
    });
    const image = this.avatars.buildUrl({
      projectId: workspace.project.id,
      id: stored.id,
    });
    await this.repository.setAvatar({ id: parsed.userId, image });

    return { image };
  }

  async removeAvatar(input: RemoveUserAvatarInput): Promise<void> {
    const parsed = removeUserAvatarInputSchema.parse(input);
    await this.repository.setAvatar({ id: parsed.userId, image: null });
  }
}
