import type { OrganizationService } from "@langwatch/organization-contract";
import {
  UserService as UserServiceContract,
  UserNotFoundError,
  createCredentialUserInputSchema,
  createPasskeyUserInputSchema,
  createUserInputSchema,
  removeUserAvatarInputSchema,
  setUserAvatarInputSchema,
  setUserHomePathInputSchema,
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
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserAvatarResult,
  type UserEmailInput,
  type UserFullProfile,
  type UserIdInput,
  type UserProfile,
  type UserProfilesInput,
  type UserSsoStatus,
  type UserTourPreference,
} from "@langwatch/user-contract";
import type { UserAvatarStoragePort } from "../ports/user.port";
import type { UserRepository } from "../repositories/user.repository";
import { UserAvatarCodec } from "./user-avatar.service";

export class UserService extends UserServiceContract {
  private readonly avatars = UserAvatarCodec.create();
  private constructor(
    private readonly repository: UserRepository,
    private readonly organizations: OrganizationService,
    private readonly avatarStorage: UserAvatarStoragePort,
    private readonly now: () => Date,
  ) {
    super();
  }

  static create(options: {
    repository: UserRepository;
    organizations: OrganizationService;
    avatarStorage: UserAvatarStoragePort;
    now?: () => Date;
  }): UserService {
    return new UserService(
      options.repository,
      options.organizations,
      options.avatarStorage,
      options.now ?? (() => new Date()),
    );
  }

  getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]> {
    const parsed = userProfilesInputSchema.parse(input);
    return this.repository.getProfiles([...new Set(parsed.userIds)]);
  }

  tryFindById(input: UserIdInput): Promise<UserProfile | null> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.tryFindById(parsed.id);
  }

  tryFindByEmail(input: UserEmailInput): Promise<UserProfile | null> {
    const parsed = userEmailInputSchema.parse(input);
    return this.repository.tryFindByEmail(parsed.email);
  }

  create(input: CreateUserInput): Promise<UserProfile> {
    return this.repository.create(createUserInputSchema.parse(input));
  }

  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    return this.repository.createCredentialUser(createCredentialUserInputSchema.parse(input));
  }

  createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser> {
    return this.repository.createPasskeyUser(createPasskeyUserInputSchema.parse(input));
  }

  hasPassword(input: UserIdInput): Promise<boolean> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.hasPassword(parsed.id);
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const parsed = updateUserProfileInputSchema.parse(input);
    const normalizedEmail =
      parsed.email === undefined ? undefined : parsed.email.trim().toLowerCase();
    const current =
      normalizedEmail === undefined ? null : await this.repository.tryFindById(parsed.id);
    if (normalizedEmail !== undefined && !current) {
      throw new UserNotFoundError(parsed.id);
    }
    const update: UpdateUserProfileInput = { id: parsed.id };
    if (parsed.name !== undefined) update.name = parsed.name;
    if (normalizedEmail !== undefined) update.email = normalizedEmail;
    const updated = await this.repository.updateProfile(update);
    return updated;
  }

  async getAccountInfo(input: UserIdInput): Promise<UserAccountInfo> {
    const parsed = userIdInputSchema.parse(input);
    const account = await this.repository.tryGetAccountInfo(parsed.id);
    if (!account) throw new UserNotFoundError(parsed.id);
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
    return this.repository.setTraceExplorerTourDismissedAt(parsed.id, this.now());
  }

  async updateLastLogin(input: UserIdInput): Promise<void> {
    const parsed = userIdInputSchema.parse(input);
    await this.repository.setLastLoginAt(parsed.id, this.now());
  }

  tryGetLastHomePath(input: UserIdInput): Promise<string | null> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.tryGetLastHomePath(parsed.id);
  }

  async setLastHomePath(input: SetUserHomePathInput): Promise<void> {
    const parsed = setUserHomePathInputSchema.parse(input);
    await this.repository.setLastHomePath(parsed.id, parsed.path);
  }

  async deactivate(input: UserIdInput): Promise<UserProfile> {
    const parsed = userIdInputSchema.parse(input);
    const user = await this.repository.setDeactivatedAt(parsed.id, this.now());
    return user;
  }

  reactivate(input: UserIdInput): Promise<UserProfile> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.setDeactivatedAt(parsed.id, null);
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
    await this.repository.setAvatar(parsed.userId, image);
    return { image };
  }

  async removeAvatar(input: RemoveUserAvatarInput): Promise<void> {
    const parsed = removeUserAvatarInputSchema.parse(input);
    await this.repository.setAvatar(parsed.userId, null);
  }
}
