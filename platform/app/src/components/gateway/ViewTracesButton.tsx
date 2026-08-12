import { Button } from "@chakra-ui/react";
import { Bird } from "lucide-react";
import { Link } from "~/components/ui/link";

/**
 * Opens the Trace Explorer filtered to the traces one virtual key produced.
 *
 * Rendered only when the key has a live trace destination the viewer can
 * reach, so whether the button is there answers "can I see this key's
 * traces" without the reader having to try it.
 */
export function ViewTracesButton({ href }: { href: string }) {
  return (
    <Button asChild size="xs" variant="outline" data-testid="vk-view-traces">
      <Link href={href}>
        <Bird size={14} aria-hidden /> View traces
      </Link>
    </Button>
  );
}
