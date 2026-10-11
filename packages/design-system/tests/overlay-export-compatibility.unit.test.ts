// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as dialogFacade from "../src/components/overlays/dialog.tsx";
import * as drawerFacade from "../src/components/overlays/drawer.tsx";
import * as studioDialog from "../src/components/overlays/studio-dialog.tsx";
import * as studioDrawer from "../src/components/overlays/studio-drawer.tsx";
import * as dialogView from "../src/components/overlays/views/dialog-view.tsx";
import * as drawerView from "../src/components/overlays/views/drawer-view.tsx";
import * as drawerInset from "../src/overlays/drawer-inset.ts";
import * as portalTarget from "../src/overlays/portal-target.ts";
import * as drawerChrome from "../src/overlays/use-drawer-chrome.ts";

describe("overlay public exports", () => {
  describe("when the drawer subpath is imported", () => {
    it("still exposes every runtime name it did before the split", () => {
      expect(Object.keys(drawerFacade).toSorted()).toEqual([
        "Drawer",
        "DrawerActions",
        "DrawerCloseTrigger",
        "DrawerContent",
        "DrawerGlassProvider",
        "DrawerOffsetProvider",
        "DrawerRoot",
        "RawDrawer",
        "setDrawerEndInset",
        "useDrawerEndInset",
        "useOverlayPortalTarget",
        "useReserveDrawerFocus",
      ]);
    });

    it("serves the same objects the implementation and the pure modules own", () => {
      expect(drawerFacade.Drawer).toBe(drawerView.Drawer);
      expect(drawerFacade.DrawerOffsetProvider).toBe(drawerInset.DrawerOffsetProvider);
      expect(drawerFacade.setDrawerEndInset).toBe(drawerInset.setDrawerEndInset);
      expect(drawerFacade.DrawerGlassProvider).toBe(drawerChrome.DrawerGlassProvider);
      expect(drawerFacade.useOverlayPortalTarget).toBe(portalTarget.useOverlayPortalTarget);
    });
  });

  describe("when the dialog subpath is imported", () => {
    it("still exposes every runtime name it did before the split", () => {
      expect(Object.keys(dialogFacade).toSorted()).toEqual([
        "Dialog",
        "DialogActionTrigger",
        "DialogBody",
        "DialogCloseTrigger",
        "DialogContent",
        "DialogDescription",
        "DialogFooter",
        "DialogHeader",
        "DialogRoot",
        "DialogTitle",
        "DialogTrigger",
        "RawDialog",
        "useOverlayPortalTarget",
      ]);
    });

    it("keeps each part alias the same object as the shape's static", () => {
      expect(dialogFacade.Dialog).toBe(dialogView.Dialog);
      expect(dialogFacade.Dialog.Footer).toBe(dialogFacade.DialogFooter);
      expect(dialogFacade.Dialog.ActionTrigger).toBe(dialogFacade.DialogActionTrigger);
    });
  });

  describe("when the studio subpaths are imported", () => {
    it("still re-exports the drawer and dialog parts", () => {
      expect(studioDrawer.Drawer).toBe(drawerFacade.Drawer);
      expect(studioDrawer.DrawerOffsetProvider).toBe(drawerFacade.DrawerOffsetProvider);
      expect(studioDrawer.DrawerBody).toBe(drawerFacade.Drawer.Body);
      expect(studioDialog.Dialog).toBe(dialogFacade.Dialog);
      expect(studioDialog.DialogFooter).toBe(dialogFacade.DialogFooter);
    });
  });
});
