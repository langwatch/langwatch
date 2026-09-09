/**
 * One configured provider credential, as the routing-policy editor offers it.
 *
 * In `platform/app` this type was declared beside the picker that renders it,
 * which is where a type usually belongs. Here it cannot be: the hook that
 * derives the option list is `behavior`, the picker is `ui/elements`, and a
 * behavior module reading a presentation one is the upward dependency the
 * layout refuses. So the shape lives in `model`, which both may read.
 */
export type ProviderCredentialOption = {
  id: string;
  modelProviderName: string;
  slot: string;
  disabledAt: string | null;
  healthStatus: string;
};
