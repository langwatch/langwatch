import type * as ElevenLabs from "../index";
/**
 * OCSF Actor object - describes the entity that performed the action.
 *
 * Spec: https://schema.ocsf.io/1.6.0/objects/actor
 */
export interface ActorModel {
    /** User who performed the action */
    user: ElevenLabs.UserModel;
    /** Client application or service name */
    appName?: string;
    /** Client application unique identifier */
    appUid?: string;
    /** Session information */
    session?: Record<string, unknown>;
}
