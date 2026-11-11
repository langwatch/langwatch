import {
  CONSENT_STORAGE_KEY,
  startTagManager,
  tagManagerId,
  type TagWindow,
} from "./tag-manager.ts";

type ConsentChoice = "accepted" | "declined";

/** The reader's stored choice on either site; none, an unknown value or refused storage is null. */
function storedConsent({ win }: { win: Pick<Window, "localStorage"> }): ConsentChoice | null {
  try {
    const value = win.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Shows the cookie notice to a reader who has not chosen, where the page would load a tag at all.
 * Their choice goes where the marketing site keeps it, so one answer covers langwatch.ai; accepting
 * starts the tag manager on this page. A choice made in another tab hides the notice here.
 */
export function startCookieNotice({ win = window }: { win?: TagWindow } = {}) {
  const notice = win.document.getElementById("docs-cookie-notice");
  if (!notice) return;
  if (!tagManagerId({ doc: win.document, host: win.location.hostname })) return;
  if (storedConsent({ win })) return;

  const close = () => {
    notice.hidden = true;
    win.removeEventListener("storage", onStorage);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY && storedConsent({ win })) close();
  };
  const decide = (choice: ConsentChoice) => {
    try {
      win.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    } catch {
      /* Storage refused: the notice asks again on the next page load. */
    }
    close();
    if (choice === "accepted") startTagManager({ win });
  };

  notice.querySelectorAll<HTMLButtonElement>("[data-docs-consent]").forEach((button) => {
    const choice = button.dataset.docsConsent;
    if (choice === "accepted" || choice === "declined")
      button.addEventListener("click", () => decide(choice));
  });
  win.addEventListener("storage", onStorage);
  notice.hidden = false;
}
