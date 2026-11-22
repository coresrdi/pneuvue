import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { injectAdvertisement } from "./lib/tpms/scan";
import { useTpms } from "./lib/tpms/store";
import "./styles.css";

declare global {
  interface Window {
    __pneuvueTest?: {
      ingest: typeof injectAdvertisement;
      clearSeen: () => void;
    };
  }
}

window.__pneuvueTest = {
  ingest: injectAdvertisement,
  clearSeen: () => useTpms.getState().clearSeenDevices(),
};

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
