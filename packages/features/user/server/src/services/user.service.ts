import type { OrganizationService } from "@langwatch/organization-contract";
import {
  UserService as UserServiceContract,
  UserNotFoundError,
  createUserInputSchema,
  removeUserAvatarInputSchema,
  setUserAvatarInputSchema,
  setUserHomePathInputSchema,
  updateUserProfileInputSchema,
  userEmailInputSchema,
  userIdInputSchema,
  type CreateUserInput,
  type RemoveUserAvatarInput,
  type SetUserAvatarInput,
  type SetUserHomePathInput,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserAvatarResult,
  type UserEmailInput,
  type UserIdInput,
  type UserProfile,
  type UserSsoStatus,
  type UserTourPreference,
} from "@langwatch/user-contract";
import type {
  UserAvatarStoragePort,
  UserCliTokenRevocationPort,
  UserSessionRevocationPort,
} from "../ports/user.port";
import { UserAvatarCodec } from "../codecs/user-avatar.codec";
import type { UserRepository } from "../repositories/user.repository";

export class UserService extends UserServiceContract {
  private readonly avatars = UserAvatarCodec.create();

  private constructor(
    private readonly repository: UserRepository,
    private readonly sessions: UserSessionRevocationPort,
    private readonly cliTokens: UserCliTokenRevocationPort,
    private readonly organizations: OrganizationService,
    private readonly avatarStorage: UserAvatarStoragePort,
    private readonly now: () => Date,
  ) {
    super();
  }

  static create(options: {
    repository: UserRepository;
    sessions: UserSessionRevocationPort;
    cliTokens: UserCliTokenRevocationPort;
    organizations: OrganizationService;
    avatarStorage: UserAvatarStoragePort;
    now?: () => Date;
  }): UserService {
    return new UserService(
      options.repository,
      options.sessions,
      options.cliTokens,
      options.organizations,
      options.avatarStorage,
      options.now ?? (() => new Date()),
    );
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

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const parsed = updateUserProfileInputSchema.parse(input);
    const normalizedEmail =
      parsed.email === undefined
        ? undefined
        : parsed.email.trim().toLowerCase();
    const current =
      normalizedEmail === undefined
        ? null
        : await this.repository.tryFindById(parsed.id);
    if (normalizedEmail !== undefined && !current) {
      throw new UserNotFoundError(parsed.id);
    }
    const emailChanged =
      normalizedEmail !== undefined &&
      (current?.email ?? "").toLowerCase() !== normalizedEmail;
    const update: UpdateUserProfileInput = { id: parsed.id };
    if (parsed.name !== undefined) update.name = parsed.name;
    if (normalizedEmail !== undefined) update.email = normalizedEmail;
    const updated = await this.repository.updateProfile(update);
    if (emailChanged) {
      await this.sessions.revokeForUser({ userId: parsed.id });
    }
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

  getTraceExplorerTourPreference(
    input: UserIdInput,
  ): Promise<UserTourPreference> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.getTraceExplorerTourPreference(parsed.id);
  }

  dismissTraceExplorerTour(
    input: UserIdInput,
  ): Promise<UserTourPreference> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.setTraceExplorerTourDismissedAt(
      parsed.id,
      this.now(),
    );
  }

  async updateLastLogin(input: UserIdInput): Promise<void> {
    const parsed = userIdInputSchema.parse(input);
    await this.repository.setLastLoginAt(parsed.id, this.now());
  }

  getLastHomePath(input: UserIdInput): Promise<string | null> {
    const parsed = userIdInputSchema.parse(input);
    return this.repository.getLastHomePath(parsed.id);
  }

  async setLastHomePath(input: SetUserHomePathInput): Promise<void> {
    const parsed = setUserHomePathInputSchema.parse(input);
    await this.repository.setLastHomePath(parsed.id, parsed.path);
  }

  async deactivate(input: UserIdInput): Promise<UserProfile> {
    const parsed = userIdInputSchema.parse(input);
    const user = await this.repository.setDeactivatedAt(
      parsed.id,
      this.now(),
    );
    await this.sessions.revokeForUser({ userId: parsed.id });
    await this.cliTokens.revokeForUser({ userId: parsed.id });
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
